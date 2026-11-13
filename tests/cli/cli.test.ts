import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createProject,
  createRateLimitNamespaceIds,
  d1IdFor,
  loadProjectOptions,
  parseArgs,
  r2NamesFor,
  shouldCopyTemplateEntry,
  slugify,
} from '../../packages/cli/src/cli.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cf-apps-unit-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('CLI argument and config parsing', () => {
  it('parses non-interactive create options and preserves positional target', () => {
    expect(parseArgs([
      'create', '../ledger', '--config-file', './ledger.json', '--yes', '--provision',
    ])).toEqual({
      positional: ['create', '../ledger'],
      options: { configFile: './ledger.json', yes: true, provision: true },
    });
  });

  it('rejects options without values and unknown flags', () => {
    expect(() => parseArgs(['create', './app', '--config-file'])).toThrow('Missing value');
    expect(() => parseArgs(['create', './app', '--unsafe'])).toThrow('Unknown option');
  });

  it('loads a strict project config and lets explicit CLI values override it', async () => {
    const directory = await temporaryDirectory();
    const configPath = path.join(directory, 'project.json');
    await writeFile(configPath, JSON.stringify({
      name: 'from-file',
      domain: 'app.example.com',
      modules: ['stripe', 'stripe', 'openrouter'],
      cloudflare: { productionBranch: 'main', previewBranches: ['stage', 'pr-preview'] },
    }));

    await expect(loadProjectOptions({ configFile: configPath, name: 'from-cli' })).resolves.toMatchObject({
      name: 'from-cli',
      domain: 'app.example.com',
      modules: 'stripe,openrouter',
      cloudflare: { productionBranch: 'main', previewBranches: ['stage', 'pr-preview'] },
    });
  });

  it('rejects malformed JSON values, secrets, and unknown provider fields', async () => {
    const directory = await temporaryDirectory();
    const configPath = path.join(directory, 'project.json');
    for (const contents of ['null', '[]', '{"OPENROUTER_API_KEY":"secret"}', '{"cloudflare":{"apiToken":"secret"}}']) {
      await writeFile(configPath, contents);
      await expect(loadProjectOptions({ configFile: configPath })).rejects.toThrow();
    }
  });
});

describe('CLI template/resource helpers', () => {
  it('normalizes names predictably', () => {
    expect(slugify('My New Project!')).toBe('my-new-project');
    expect(slugify('東京')).toBe('my-app');
  });

  it('generates four distinct positive Cloudflare namespace IDs per project', () => {
    const namespaces = createRateLimitNamespaceIds();
    const ids = [namespaces.production.api, namespaces.production.auth, namespaces.preview.api, namespaces.preview.auth];
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => /^[1-9]\d*$/.test(id))).toBe(true);
  });

  it('keeps examples while excluding local state, credentials, caches, and secret file formats', async () => {
    const root = await temporaryDirectory();
    const files = [
      '.dev.vars', '.dev.vars.example', '.env.production', '.env.example', '.boilerplate.json',
      '.npmrc', 'service-account.json', 'keys/signing-key.pem', 'apps/web/node_modules/a.js',
      'apps/web/.wrangler/state.json', 'src/index.ts', 'project-config.json',
    ];
    for (const file of files) {
      const absolutePath = path.join(root, file);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, 'fixture');
    }
    const decisions = await Promise.all(files.map((file) => shouldCopyTemplateEntry(
      path.join(root, file), root, file === 'project-config.json' ? path.join(root, file) : undefined,
    )));
    expect(Object.fromEntries(files.map((file, index) => [file, decisions[index]]))).toEqual({
      '.dev.vars': false,
      '.dev.vars.example': true,
      '.env.production': false,
      '.env.example': true,
      '.boilerplate.json': false,
      '.npmrc': false,
      'service-account.json': false,
      'keys/signing-key.pem': false,
      'apps/web/node_modules/a.js': false,
      'apps/web/.wrangler/state.json': false,
      'src/index.ts': true,
      'project-config.json': false,
    });
  });

  it('extracts D1 IDs and R2 bucket names from Wrangler output', () => {
    expect(d1IdFor(JSON.stringify([{ name: 'ledger-production', uuid: 'd1-uuid' }]), 'ledger-production')).toBe('d1-uuid');
    expect(d1IdFor('[{"name":"other","uuid":"d1-uuid"}]', 'ledger-production')).toBeUndefined();
    expect([...r2NamesFor('┌──────────────┬──────────────┐\n│ Name         │ Created      │\n├──────────────┼──────────────┤\n│ ledger-files │ 2026-01-01   │\n└──────────────┴──────────────┘')]).toEqual(['ledger-files']);
  });

  it('refuses to overwrite an existing project directory', async () => {
    const parent = await temporaryDirectory();
    const destination = path.join(parent, 'existing');
    await mkdir(destination);
    await writeFile(path.join(destination, 'keep.txt'), 'keep');
    await expect(createProject(destination, { yes: true })).rejects.toThrow('will not overwrite');
    await expect(readFile(path.join(destination, 'keep.txt'), 'utf8')).resolves.toBe('keep');
  });

  it('rejects destinations inside the template before creating parent folders', async () => {
    const parent = path.join(process.cwd(), `.__cf_apps_guard_${process.pid}_${Date.now()}`);
    await expect(createProject(path.join(parent, 'nested', 'app'), { yes: true })).rejects.toThrow('outside the boilerplate repository');
    await expect(access(parent)).rejects.toThrow();
  });

  it('creates a configured project without copying source-local state', async () => {
    const parent = await temporaryDirectory();
    const destination = path.join(parent, 'generated-app');
    await createProject(destination, { yes: true, name: 'Generated App', modules: 'stripe' });

    const manifest = JSON.parse(await readFile(path.join(destination, '.boilerplate.json'), 'utf8'));
    const packageJson = JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8'));
    const wrangler = JSON.parse(await readFile(path.join(destination, 'apps', 'web', 'wrangler.jsonc'), 'utf8'));
    expect(manifest.projectName).toBe('generated-app');
    expect(manifest.modules).toContain('stripe');
    expect(packageJson.name).toBe('generated-app');
    expect(wrangler.d1_databases[0].database_name).toBe('generated-app-production');
    expect(wrangler.ratelimits.map((binding: { namespace_id: string }) => binding.namespace_id)).toEqual([
      manifest.cloudflare.rateLimitNamespaces.production.api,
      manifest.cloudflare.rateLimitNamespaces.production.auth,
    ]);
    expect(wrangler.previews.ratelimits.map((binding: { namespace_id: string }) => binding.namespace_id)).toEqual([
      manifest.cloudflare.rateLimitNamespaces.preview.api,
      manifest.cloudflare.rateLimitNamespaces.preview.auth,
    ]);
    await expect(readFile(path.join(destination, '.git', 'config'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(destination, 'apps', 'web', '.dev.vars'), 'utf8')).resolves.toContain('TENANT_CONTEXT_SECRET=');
  });
});
