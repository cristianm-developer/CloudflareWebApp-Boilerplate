#!/usr/bin/env node
import { readFile, writeFile, access, cp, mkdir, realpath, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';

const CONFIG_FILE = '.boilerplate.json';
const CLI_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_TEMPLATE = path.resolve(CLI_DIRECTORY, '../../..');
const BUNDLED_TEMPLATE = path.resolve(CLI_DIRECTORY, '../template');
const CORE_MODULES = ['auth', 'tenants', 'permissions', 'quotas', 'admin'];
const MODULES = {
  auth: {
    label: 'Better Auth and tenant-context authentication',
    env: ['BETTER_AUTH_SECRET', 'TENANT_CONTEXT_SECRET'],
    checks: ['api/modules/auth/index.ts', 'migrations/0002_better_auth.sql'],
  },
  tenants: {
    label: 'Tenant context',
    env: [],
    checks: ['api/modules/tenants/index.ts', 'migrations/0001_initial.sql'],
  },
  permissions: {
    label: 'Tenant permissions',
    env: [],
    checks: ['api/modules/tenants/index.ts', 'packages/contracts/src/index.ts'],
  },
  admin: {
    label: 'Tenant administration',
    env: [],
    checks: ['api/modules/admin/index.ts'],
  },
  quotas: {
    label: 'Tenant product quotas',
    env: [],
    checks: ['api/modules/quotas/index.ts', 'migrations/0003_quotas.sql'],
  },
  stripe: {
    label: 'Stripe billing',
    env: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'APP_BASE_URL'],
    checks: ['api/modules/billing/index.ts', 'api/modules/billing/stripe.ts', 'migrations/0004_billing.sql'],
  },
  'google-play': {
    label: 'Google Play Billing',
    env: ['GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', 'GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_PUBSUB_AUDIENCE', 'GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL'],
    checks: ['apps/mobile/pubspec.yaml', 'api/modules/billing/google-play.ts', 'migrations/0004_billing.sql'],
  },
  openrouter: {
    label: 'OpenRouter AI',
    env: ['OPENROUTER_API_KEY'],
    checks: ['api/modules/ai/openrouter.ts'],
  },
  resend: {
    label: 'Resend email',
    env: ['RESEND_API_KEY', 'RESEND_FROM'],
    checks: ['api/modules/email/resend.ts'],
  },
  flutter: {
    label: 'Flutter WebView app',
    env: [],
    checks: ['apps/mobile/pubspec.yaml'],
  },
};

const HELP = `Cloudflare Apps boilerplate CLI

Usage:
  cf-apps create <directory> [--config-file <file>] [--name <name>] [--domain <domain>] [--modules <list>] [--yes] [--provision]
  cf-apps init [--config-file <file>] [--name <name>] [--domain <domain>] [--modules <list>] [--yes] [--provision]
  cf-apps add <module> [--config-only]
  cf-apps resources [--yes]
  cf-apps doctor
  cf-apps --help

Modules:
  stripe, google-play, openrouter, resend, flutter

Examples:
  cf-apps create ../my-app
  cf-apps create ../my-app --config-file ./project-config.json --yes
  cf-apps init
  cf-apps init --name ledger --modules stripe,openrouter --yes
  cf-apps add google-play
  cf-apps resources
  cf-apps doctor

`;

export function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--provision') options.provision = true;
    else if (arg === '--config-only') options.configOnly = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--name' || arg === '--domain' || arg === '--modules' || arg === '--config-file') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value;
      i += 1;
    } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  return { positional, options };
}

export async function loadProjectOptions(options) {
  if (!options.configFile) return options;
  const configPath = path.resolve(process.cwd(), options.configFile);
  let config;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) { throw new Error(`Cannot read project config ${configPath}: ${error.message}`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Project config must be a JSON object.');
  const allowedKeys = new Set(['name', 'domain', 'modules', 'cloudflare']);
  for (const key of Object.keys(config)) if (!allowedKeys.has(key)) throw new Error(`Unsupported project config field "${key}". Secrets and unknown fields are not accepted.`);
  if (config.name !== undefined && typeof config.name !== 'string') throw new Error('Project config "name" must be a string.');
  if (config.domain !== undefined && typeof config.domain !== 'string') throw new Error('Project config "domain" must be a string.');
  if (config.modules !== undefined && (!Array.isArray(config.modules) || config.modules.some((moduleName) => typeof moduleName !== 'string'))) {
    throw new Error('Project config "modules" must be an array of module names.');
  }
  if (config.modules) config.modules = [...new Set(config.modules.map(normalizeModule))].join(',');
  if (config.cloudflare !== undefined) {
    if (!config.cloudflare || typeof config.cloudflare !== 'object' || Array.isArray(config.cloudflare)) throw new Error('Project config "cloudflare" must be an object.');
    const cloudflareKeys = new Set(['workerName', 'accountId', 'productionBranch', 'previewBranches', 'productionDatabase', 'stageDatabase', 'productionBucket', 'stageBucket']);
    for (const [key, value] of Object.entries(config.cloudflare)) {
      if (!cloudflareKeys.has(key)) throw new Error(`Unsupported Cloudflare config field "${key}".`);
      if (key === 'previewBranches') {
        if (!Array.isArray(value) || value.some((branch) => typeof branch !== 'string')) throw new Error('Cloudflare "previewBranches" must be an array of strings.');
      } else if (typeof value !== 'string') throw new Error(`Cloudflare "${key}" must be a string.`);
    }
  }
  return { ...config, ...options, cloudflare: { ...(config.cloudflare ?? {}), ...(options.cloudflare ?? {}) } };
}

function normalizeModule(name) {
  const normalized = name.trim().toLowerCase();
  if (!MODULES[normalized]) throw new Error(`Unknown module "${name}". Choose: ${Object.keys(MODULES).join(', ')}`);
  return normalized;
}

export function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-app';
}

export function createRateLimitNamespaceIds() {
  const uniqueIds = new Set();
  while (uniqueIds.size < 4) uniqueIds.add(String((randomBytes(4).readUInt32BE(0) % 2_147_483_647) + 1));
  const [productionApi, productionAuth, previewApi, previewAuth] = [...uniqueIds];
  return {
    production: { api: productionApi, auth: productionAuth },
    preview: { api: previewApi, auth: previewAuth },
  };
}

async function pathExists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}

async function getTemplateRoot() {
  if (await pathExists(path.join(REPOSITORY_TEMPLATE, 'apps', 'web', 'wrangler.jsonc'))
      && await pathExists(path.join(REPOSITORY_TEMPLATE, 'pnpm-workspace.yaml'))) return REPOSITORY_TEMPLATE;
  if (await pathExists(path.join(BUNDLED_TEMPLATE, 'apps', 'web', 'wrangler.jsonc'))
      && await pathExists(path.join(BUNDLED_TEMPLATE, 'pnpm-workspace.yaml'))) return BUNDLED_TEMPLATE;
  throw new Error('The project template is not available. Run cf-apps from the boilerplate repository or install the published CLI package that includes its template.');
}

export async function shouldCopyTemplateEntry(sourcePath, templateRoot, excludedFile) {
  const sourceAbsolutePath = path.resolve(sourcePath);
  const excludedAbsolutePath = excludedFile ? path.resolve(excludedFile) : null;
  if (excludedAbsolutePath && (process.platform === 'win32'
    ? sourceAbsolutePath.toLowerCase() === excludedAbsolutePath.toLowerCase()
    : sourceAbsolutePath === excludedAbsolutePath)) return false;
  try { if ((await lstat(sourcePath)).isSymbolicLink()) return false; }
  catch { return false; }
  const relativePath = path.relative(templateRoot, sourcePath);
  const parts = relativePath.split(path.sep);
  const excludedDirectories = new Set(['.git', '.wrangler', '.astro', '.dart_tool', 'node_modules', 'dist', 'build', 'coverage', '.cursor', '.codex', '.idea', '.vscode', '.turbo', '.pnpm-store', '.codebase-memory']);
  if (parts.some((part) => excludedDirectories.has(part))) return false;
  if (parts.includes('template') && parts[parts.indexOf('template') - 1] === 'cli') return false;
  const name = parts.at(-1) ?? '';
  if (name === CONFIG_FILE || name === '.dev.vars' || name === '.env' || name === '.npmrc' || name === '.netrc') return false;
  if (name.startsWith('.dev.vars.') && name !== '.dev.vars.example') return false;
  if (name.startsWith('.env.') && name !== '.env.example') return false;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(name) || /(^|[._-])(secret|secrets|credential|credentials|private[-_]?key|service[-_]?account)([._-]|$)/i.test(name)) return false;
  return true;
}

export async function createProject(target, options = {}) {
  if (!target) throw new Error('Usage: cf-apps create <directory>');
  const templateRoot = await getTemplateRoot();
  const realTemplateRoot = await realpath(templateRoot);
  const requestedTarget = path.resolve(process.cwd(), target);
  const lexicalRelative = path.relative(realTemplateRoot, requestedTarget);
  if (!lexicalRelative || (!lexicalRelative.startsWith(`..${path.sep}`) && lexicalRelative !== '..' && !path.isAbsolute(lexicalRelative))) {
    throw new Error('Choose a new destination outside the boilerplate repository so the template cannot copy into itself.');
  }
  const parent = path.dirname(requestedTarget);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  const destination = path.join(realParent, path.basename(requestedTarget));
  const relativeToTemplate = path.relative(realTemplateRoot, destination);
  if (!relativeToTemplate || (!relativeToTemplate.startsWith(`..${path.sep}`) && relativeToTemplate !== '..' && !path.isAbsolute(relativeToTemplate))) {
    throw new Error('Choose a new destination outside the boilerplate repository so the template cannot copy into itself.');
  }
  if (await pathExists(destination)) throw new Error(`Destination already exists: ${destination}. Choose a new, empty path; create will not overwrite files.`);

  await mkdir(destination);
  try {
    await cp(templateRoot, destination, {
      recursive: true,
      filter: (sourcePath) => shouldCopyTemplateEntry(
        sourcePath,
        templateRoot,
        options.configFile ? path.resolve(process.cwd(), options.configFile) : undefined,
      ),
    });
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw new Error(`Could not copy the project template: ${error.message}`);
  }

  const projectName = options.name ?? path.basename(destination);
  const rootPackagePath = path.join(destination, 'package.json');
  const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8'));
  rootPackage.name = slugify(projectName);
  await writeFile(rootPackagePath, `${JSON.stringify(rootPackage, null, 2)}\n`, 'utf8');
  console.log(`Created project files in ${destination}.`);
  console.log('Configuring the new project…');
  const setup = await runInit(destination, { ...options, name: projectName, deferProvision: true });
  if (setup.provisionRequested) {
    console.log('Installing dependencies before provisioning Cloudflare resources…');
    await runPnpm(destination, ['install']);
    await provisionResources(destination, setup.config);
  }
  console.log(setup.provisionRequested
    ? `Next: cd "${destination}"; pnpm dev`
    : `Next: cd "${destination}"; pnpm install; pnpm dev`);
}

function runPnpm(cwd, args) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`pnpm ${args.join(' ')} exited with code ${code}`)));
  });
}

async function readConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  if (!(await pathExists(file))) return null;
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(`Cannot read ${CONFIG_FILE}: ${error.message}`); }
}

async function writeConfig(root, config, { overwrite = false } = {}) {
  const file = path.join(root, CONFIG_FILE);
  if (!overwrite && await pathExists(file)) throw new Error(`${CONFIG_FILE} already exists. Use "cf-apps add <module>" to update modules.`);
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
}

async function promptLine(rl, label, fallback = '') {
  const answer = (await rl.question(`${label}${fallback ? ` (${fallback})` : ''}: `)).trim();
  return answer || fallback;
}

async function promptModules(rl) {
  const selected = [];
  for (const [key, module] of Object.entries(MODULES)) {
    const answer = (await rl.question(`Enable ${module.label}? [y/N] `)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') selected.push(key);
  }
  return selected;
}

async function promptCloudflare(rl, projectName, configured = {}) {
  const previewBranch = await promptLine(rl, 'Preview branch', configured.previewBranches?.join(',') || 'stage');
  const accountId = await promptLine(rl, 'Cloudflare account ID (optional; blank lets Wrangler select)', configured.accountId ?? '');
  return {
    workerName: await promptLine(rl, 'Cloudflare Worker name', configured.workerName || projectName),
    productionBranch: await promptLine(rl, 'Production branch', configured.productionBranch || 'main'),
    previewBranches: previewBranch.split(',').map((value) => value.trim()).filter(Boolean),
    productionDatabase: await promptLine(rl, 'Production D1 database name', configured.productionDatabase || `${projectName}-production`),
    stageDatabase: await promptLine(rl, 'Preview D1 database name', configured.stageDatabase || `${projectName}-stage`),
    productionBucket: await promptLine(rl, 'Production R2 bucket name', configured.productionBucket || `${projectName}-production`),
    stageBucket: await promptLine(rl, 'Preview R2 bucket name', configured.stageBucket || `${projectName}-stage`),
    ...(accountId ? { accountId } : {}),
  };
}

async function applyCloudflareConfig(root, cloudflare) {
  const file = path.join(root, 'apps', 'web', 'wrangler.jsonc');
  if (!(await pathExists(file))) return;
  const worker = JSON.parse(await readFile(file, 'utf8'));
  worker.name = cloudflare.workerName;
  if (cloudflare.accountId) worker.account_id = cloudflare.accountId;
  else delete worker.account_id;
  const productionDatabase = worker.d1_databases?.find((database) => database.binding === 'DB');
  const productionBucket = worker.r2_buckets?.find((bucket) => bucket.binding === 'FILES');
  const stageDatabase = worker.previews?.d1_databases?.find((database) => database.binding === 'DB');
  const stageBucket = worker.previews?.r2_buckets?.find((bucket) => bucket.binding === 'FILES');
  if (!productionDatabase || !productionBucket || !stageDatabase || !stageBucket) {
    throw new Error('wrangler.jsonc is missing a production or Preview DB/FILES binding.');
  }
  productionDatabase.database_name = cloudflare.productionDatabase;
  productionBucket.bucket_name = cloudflare.productionBucket;
  stageDatabase.database_name = cloudflare.stageDatabase;
  stageBucket.bucket_name = cloudflare.stageBucket;

  const namespaces = cloudflare.rateLimitNamespaces ?? createRateLimitNamespaceIds();
  const productionApi = worker.ratelimits?.find((binding) => binding.name === 'API_RATE_LIMITER');
  const productionAuth = worker.ratelimits?.find((binding) => binding.name === 'AUTH_RATE_LIMITER');
  const previewApi = worker.previews?.ratelimits?.find((binding) => binding.name === 'API_RATE_LIMITER');
  const previewAuth = worker.previews?.ratelimits?.find((binding) => binding.name === 'AUTH_RATE_LIMITER');
  if (!productionApi || !productionAuth || !previewApi || !previewAuth) {
    throw new Error('wrangler.jsonc is missing a production or Preview rate-limit binding.');
  }
  productionApi.namespace_id = namespaces.production.api;
  productionAuth.namespace_id = namespaces.production.auth;
  previewApi.namespace_id = namespaces.preview.api;
  previewAuth.namespace_id = namespaces.preview.auth;
  await writeFile(file, `${JSON.stringify(worker, null, 2)}\n`, 'utf8');
}

function runWrangler(root, args) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const child = spawn(command, ['--filter', '@boilerplate/web', 'exec', 'wrangler', ...args], {
      cwd: root,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let stdoutText = '';
    let stderrText = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdoutText += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderrText += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdoutText.trim());
      else reject(new Error((stderrText || stdoutText || `Wrangler exited with code ${code}`).trim()));
    });
  });
}

function parseJsonOutput(output, label) {
  const start = output.search(/[\[{]/);
  if (start < 0) throw new Error(`Wrangler did not return JSON for ${label}.`);
  try { return JSON.parse(output.slice(start)); }
  catch { throw new Error(`Could not parse Wrangler JSON response for ${label}.`); }
}

function flattenRecords(value) {
  if (Array.isArray(value)) return value.flatMap(flattenRecords);
  if (value && typeof value === 'object') return [value, ...Object.values(value).flatMap(flattenRecords)];
  return [];
}

export function d1IdFor(output, name) {
  const records = flattenRecords(parseJsonOutput(output, 'D1 list'));
  const found = records.find((entry) => (entry.name === name || entry.database_name === name) && (entry.uuid || entry.database_id || entry.id));
  return found?.uuid ?? found?.database_id ?? found?.id;
}

export function r2NamesFor(output) {
  const names = new Set();
  for (const line of output.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const value = line.trim().replace(/^│|│$/g, '').trim();
    if (!value || /^[-+┌┐└┘├┤┬┴┼│ ]+$/.test(value) || /^name\b/i.test(value)) continue;
    const firstCell = value.split(/\s{2,}|│/)[0]?.trim();
    if (firstCell && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(firstCell)) names.add(firstCell);
  }
  return names;
}

async function promptProvision() {
  if (!stdin.isTTY) return false;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question('Create missing Cloudflare D1/R2 resources now? [y/N] ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally { rl.close(); }
}

async function provisionResources(root, config) {
  const cf = config?.cloudflare;
  if (!cf) throw new Error(`Run "cf-apps init" first (missing Cloudflare configuration in ${CONFIG_FILE}).`);
  const resourceNames = [cf.productionDatabase, cf.stageDatabase, cf.productionBucket, cf.stageBucket];
  for (const name of resourceNames) {
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) {
      throw new Error(`Invalid Cloudflare resource name "${name}". Use 3–63 lowercase letters, numbers, or hyphens; do not start or end with a hyphen.`);
    }
  }
  console.log('Checking the selected Cloudflare account with Wrangler…');
  await runWrangler(root, ['whoami']);
  let databases = await runWrangler(root, ['d1', 'list', '--json']);
  let buckets = r2NamesFor(await runWrangler(root, ['r2', 'bucket', 'list']));
  const databaseIds = {};
  const targetDatabases = [
    ['production', cf.productionDatabase],
    ['stage', cf.stageDatabase],
  ];
  for (const [environment, name] of targetDatabases) {
    let id = d1IdFor(databases, name);
    if (!id) {
      console.log(`Creating D1 database ${name}…`);
      await runWrangler(root, ['d1', 'create', name]);
      databases = await runWrangler(root, ['d1', 'list', '--json']);
      id = d1IdFor(databases, name);
    } else console.log(`Reusing existing D1 database ${name}.`);
    if (!id) throw new Error(`Could not resolve the ID for D1 database ${name}; no config IDs were changed.`);
    databaseIds[environment] = id;
  }
  for (const name of [cf.productionBucket, cf.stageBucket]) {
    if (buckets.has(name)) console.log(`Reusing existing R2 bucket ${name}.`);
    else {
      console.log(`Creating R2 bucket ${name}…`);
      await runWrangler(root, ['r2', 'bucket', 'create', name]);
      buckets = r2NamesFor(await runWrangler(root, ['r2', 'bucket', 'list']));
      if (!buckets.has(name)) throw new Error(`Wrangler created ${name}, but it was not present in the follow-up R2 list.`);
    }
  }
  await writeD1Ids(root, databaseIds);
  console.log('Cloudflare D1 and R2 resources are ready; Wrangler configuration now contains the D1 IDs.');
}

async function writeD1Ids(root, ids) {
  const file = path.join(root, 'apps', 'web', 'wrangler.jsonc');
  let content = await readFile(file, 'utf8');
  const updateDatabase = (databaseName, id) => {
    const escapedName = databaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`("database_name"\\s*:\\s*"${escapedName}"\\s*,\\s*"database_id"\\s*:\\s*)"[^"]*"`);
    if (!pattern.test(content)) throw new Error(`Could not find the ${databaseName} D1 binding in wrangler.jsonc; no IDs were written.`);
    content = content.replace(pattern, `$1${JSON.stringify(id)}`);
  };
  const config = await readConfig(root);
  updateDatabase(config.cloudflare.productionDatabase, ids.production);
  updateDatabase(config.cloudflare.stageDatabase, ids.stage);
  await writeFile(file, content, 'utf8');
}

async function runInit(root, options) {
  if (await pathExists(path.join(root, CONFIG_FILE))) throw new Error(`${CONFIG_FILE} already exists. This command will not overwrite it.`);
  let name = options.name;
  let domain = options.domain;
  let modules = options.modules ? (Array.isArray(options.modules) ? options.modules : options.modules.split(',')).map(normalizeModule) : [];
  let cloudflare = options.cloudflare;

  if (!options.yes && stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      name ||= await promptLine(rl, 'Project name', path.basename(root));
      if (domain === undefined) domain = await promptLine(rl, 'Production domain (optional)', '');
      if (!options.modules) modules = await promptModules(rl);
      cloudflare = await promptCloudflare(rl, slugify(name), cloudflare);
    } finally { rl.close(); }
  } else {
    name ||= path.basename(root);
  }

  const projectName = slugify(name);
  cloudflare = {
    workerName: projectName,
    productionBranch: 'main',
    previewBranches: ['stage'],
    productionDatabase: `${projectName}-production`,
    stageDatabase: `${projectName}-stage`,
    productionBucket: `${projectName}-production`,
    stageBucket: `${projectName}-stage`,
    rateLimitNamespaces: createRateLimitNamespaceIds(),
    ...(cloudflare ?? {}),
  };
  const config = {
    schemaVersion: 1,
    projectName,
    ...(domain ? { domain } : {}),
    coreModules: [...CORE_MODULES],
    modules: [],
    plannedModules: [],
    cloudflare: {
      ...cloudflare,
      workerStrategy: 'single-worker-branch-previews',
      isolatedBindings: ['DB', 'FILES'],
    },
  };
  for (const moduleName of modules) {
    if (await moduleIsScaffolded(root, moduleName)) config.modules.push(moduleName);
    else config.plannedModules.push(moduleName);
  }
  await writeConfig(root, config);
  await applyCloudflareConfig(root, cloudflare);
  await ensureEnvironmentExamples(root, [...config.modules, ...config.plannedModules]);
  const localEnvCreated = await ensureLocalEnvironment(root);
  console.log(`Configured ${projectName} in ${CONFIG_FILE}.`);
  if (config.plannedModules.length) console.log(`Recorded as planned (scaffold not present): ${config.plannedModules.join(', ')}.`);
  console.log(localEnvCreated
    ? 'Created apps/web/.dev.vars with local-only Better Auth and tenant-context secrets.'
    : 'Kept existing apps/web/.dev.vars unchanged; verify its local auth settings with cf-apps doctor.');
  console.log('Next: run pnpm dev. Production and Preview secrets must be configured separately with Wrangler.');
  console.log('Use "cf-apps resources" to create or reuse the configured Cloudflare D1 databases and R2 buckets.');
  const provisionRequested = options.provision || (!options.yes && await promptProvision());
  if (provisionRequested && !options.deferProvision) await provisionResources(root, config);
  return { config, provisionRequested };
}

async function moduleIsScaffolded(root, moduleName) {
  for (const requiredPath of MODULES[moduleName].checks) {
    if (!(await pathExists(path.join(root, requiredPath)))) return false;
  }
  return true;
}

async function ensureEnvironmentExamples(root, modules) {
  const vars = new Set(['APP_ENV', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'TENANT_CONTEXT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  for (const moduleName of modules) for (const variable of MODULES[moduleName].env) vars.add(variable);
  const examples = [path.join(root, '.dev.vars.example'), path.join(root, 'apps', 'web', '.dev.vars.example')];
  for (const examplePath of examples) {
    if (!(await pathExists(path.dirname(examplePath)))) continue;
    const existing = await pathExists(examplePath) ? await readFile(examplePath, 'utf8') : '# Copy these names into the local secret store; do not commit secret values.\n';
    const present = new Set(existing.split(/\r?\n/).map((line) => line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1]).filter(Boolean));
    const missing = [...vars].filter((variable) => !present.has(variable)).sort();
    if (missing.length) {
      const separator = existing.length && !existing.endsWith('\n') ? '\n' : '';
      await writeFile(examplePath, `${existing}${separator}${missing.map((variable) => `${variable}=${exampleValue(variable)}`).join('\n')}\n`, { flag: 'w' });
    } else if (!(await pathExists(examplePath))) {
      await writeFile(examplePath, existing, { flag: 'wx' });
    }
  }
  const envPath = path.join(root, '.env.example');
  if (!(await pathExists(envPath))) await writeFile(envPath, '# Add browser-safe public settings here only. Never put server secrets in this file.\n', { flag: 'wx' });
}

function exampleValue(variable) {
  if (variable === 'APP_ENV') return 'development';
  if (variable === 'BETTER_AUTH_URL') return 'http://localhost:4321';
  return '';
}

async function ensureLocalEnvironment(root) {
  const file = path.join(root, 'apps', 'web', '.dev.vars');
  if (await pathExists(file)) return false;
  const contents = [
    '# Local-only secrets. This file is ignored by Git.',
    'APP_ENV=development',
    'BETTER_AUTH_URL=http://localhost:4321',
    `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64url')}`,
    `TENANT_CONTEXT_SECRET=${randomBytes(32).toString('base64url')}`,
    '',
  ].join('\n');
  try {
    await writeFile(file, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

async function runAdd(root, rawModule, options) {
  if (!rawModule) throw new Error('Usage: cf-apps add <module>');
  const moduleName = normalizeModule(rawModule);
  const config = await readConfig(root);
  if (!config) throw new Error(`Run "cf-apps init" first (missing ${CONFIG_FILE}).`);
  config.coreModules = [...CORE_MODULES];
  config.modules ??= [];
  config.plannedModules ??= [];
  if (CORE_MODULES.includes(moduleName)) {
    console.log(`${moduleName} is part of the core modules.`);
    return;
  }
  if (options.configOnly) {
    config.modules = config.modules.filter((name) => name !== moduleName);
    config.plannedModules = [...new Set([...config.plannedModules, moduleName])].sort();
    await writeConfig(root, config, { overwrite: true });
    await ensureEnvironmentExamples(root, [...config.modules, ...config.plannedModules]);
    console.log(`${moduleName} recorded as planned; no implementation was added.`);
    console.log(`Implement these paths before marking it active: ${MODULES[moduleName].checks.join(', ')}`);
    return;
  }
  if (!(await moduleIsScaffolded(root, moduleName))) {
    throw new Error(`${moduleName} is not scaffolded yet. No files were changed. Use "cf-apps add ${moduleName} --config-only" to record it as planned, or implement: ${MODULES[moduleName].checks.join(', ')}`);
  }
  config.modules = [...new Set([...config.modules, moduleName])].sort();
  config.plannedModules = config.plannedModules.filter((name) => name !== moduleName);
  await writeConfig(root, config, { overwrite: true });
  await ensureEnvironmentExamples(root, config.modules);
  console.log(`${MODULES[moduleName].label} added to configured modules.`);
}

async function runDoctor(root) {
  const problems = [];
  const config = await readConfig(root).catch((error) => { problems.push(error.message); return null; });
  if (!config) problems.push(`Missing ${CONFIG_FILE}; run "cf-apps init".`);
  else {
    if (config.schemaVersion !== 1) problems.push(`Unsupported ${CONFIG_FILE} schemaVersion.`);
    if (!config.projectName) problems.push('projectName is missing from configuration.');
    config.coreModules = [...CORE_MODULES];
    for (const moduleName of config.plannedModules ?? []) {
      if (!MODULES[moduleName]) problems.push(`Unknown planned module: ${moduleName}`);
      else console.log(`Planned only (not implemented): ${moduleName}`);
    }
    for (const moduleName of new Set([...(config.coreModules ?? []), ...(config.modules ?? [])])) {
      if (!MODULES[moduleName]) { problems.push(`Unknown configured module: ${moduleName}`); continue; }
      if (!(await moduleIsScaffolded(root, moduleName))) problems.push(`${moduleName} is marked active but its scaffold is missing: ${MODULES[moduleName].checks.join(', ')}`);
    }
  }
  for (const required of ['package.json', 'apps/web/wrangler.jsonc', '.dev.vars.example', 'apps/web/.dev.vars.example']) {
    if (!(await pathExists(path.join(root, required)))) problems.push(`Missing ${required}.`);
  }
  const localEnvPath = path.join(root, 'apps', 'web', '.dev.vars');
  if (await pathExists(localEnvPath)) {
    const localEnv = await readFile(localEnvPath, 'utf8');
    const parsed = new Map(localEnv.split(/\r?\n/).map((line) => {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      return match ? [match[1], match[2].replace(/^("([\s\S]*)"|'([\s\S]*)')$/, (_, _full, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted ?? '')] : null;
    }).filter(Boolean));
    const enabledModules = new Set([
      ...(config.coreModules ?? ['auth', 'tenants', 'permissions', 'quotas', 'admin']),
      ...(config.modules ?? []),
    ]);
    const requiredVariables = new Set(['APP_ENV', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'TENANT_CONTEXT_SECRET']);
    for (const moduleName of enabledModules) {
      for (const variable of MODULES[moduleName]?.env ?? []) requiredVariables.add(variable);
    }
    for (const required of requiredVariables) {
      if (!parsed.get(required)) problems.push(`apps/web/.dev.vars is missing a non-empty ${required} value.`);
    }
  }
  if (problems.length) {
    console.error('Configuration needs attention:');
    for (const problem of [...new Set(problems)]) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('Boilerplate configuration looks consistent.');
  const enabled = [...new Set([...(config?.coreModules ?? []), ...(config?.modules ?? [])])];
  const requiredEnvNames = [...new Set([
    'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'TENANT_CONTEXT_SECRET',
    ...enabled.flatMap((moduleName) => MODULES[moduleName]?.env ?? []),
  ])].sort();
  console.log(`Required Cloudflare bindings: DB, FILES, API_RATE_LIMITER, AUTH_RATE_LIMITER.`);
  if (requiredEnvNames.length) console.log(`Configured module secret/config names (values hidden): ${requiredEnvNames.join(', ')}.`);
  console.log('This checks local files only; it does not verify Cloudflare resources, OAuth credentials, or store setup.');
}

export async function main() {
  try {
    const { positional, options: rawOptions } = parseArgs(process.argv.slice(2));
    const options = await loadProjectOptions(rawOptions);
    const [command, argument] = positional;
    if (options.help || !command) { console.log(HELP); return; }
    const root = process.cwd();
    if (command === 'create') await createProject(argument, options);
    else if (command === 'init') await runInit(root, options);
    else if (command === 'add') await runAdd(root, argument, options);
    else if (command === 'resources') {
      const config = await readConfig(root);
      if (!config) throw new Error(`Run "cf-apps init" first (missing ${CONFIG_FILE}).`);
      if (!options.yes && !(await promptProvision())) {
        console.log('No Cloudflare resources were created. Run "cf-apps resources --yes" to proceed.');
        return;
      }
      await provisionResources(root, config);
    }
    else if (command === 'doctor') await runDoctor(root);
    else throw new Error(`Unknown command "${command}". Run "cf-apps --help".`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]) {
  try {
    if (await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) await main();
  } catch {
    // Importing this module from a test runner must not execute the CLI.
  }
}
