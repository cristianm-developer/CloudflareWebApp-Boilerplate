import { cp, mkdir, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliDirectory = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(cliDirectory, '../..');
const templateDirectory = path.join(cliDirectory, 'template');
const excludedDirectories = new Set([
  '.git', '.wrangler', '.astro', '.dart_tool', 'node_modules', 'dist', 'build',
  'coverage', '.cursor', '.codex', '.idea', '.vscode', '.turbo', '.pnpm-store', '.codebase-memory',
]);

async function includeEntry(sourcePath) {
  try { if ((await lstat(sourcePath)).isSymbolicLink()) return false; }
  catch { return false; }
  const relativePath = path.relative(repositoryRoot, sourcePath);
  const parts = relativePath.split(path.sep);
  if (parts.some((part) => excludedDirectories.has(part))) return false;
  if (parts.includes('template') && parts[parts.indexOf('template') - 1] === 'cli') return false;
  const name = parts.at(-1) ?? '';
  if (name === '.boilerplate.json' || name === '.dev.vars' || name === '.env' || name === '.npmrc' || name === '.netrc') return false;
  if (name.startsWith('.dev.vars.') && name !== '.dev.vars.example') return false;
  if (name.startsWith('.env.') && name !== '.env.example') return false;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(name) || /(^|[._-])(secret|secrets|credential|credentials|private[-_]?key|service[-_]?account)([._-]|$)/i.test(name)) return false;
  return true;
}

await rm(templateDirectory, { recursive: true, force: true });
await mkdir(templateDirectory, { recursive: true });
await cp(repositoryRoot, templateDirectory, { recursive: true, filter: includeEntry });
console.log(`Prepared project template at ${templateDirectory}`);
