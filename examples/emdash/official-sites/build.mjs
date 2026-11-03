import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
await import('./verify-upstream.mjs');
const root = dirname(fileURLToPath(import.meta.url));
for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['blank', 'starter', 'blog']) {
  if (!['blank', 'starter', 'blog'].includes(mode)) throw new Error('Unknown official template.');
  execFileSync(process.execPath, [join(root, 'node_modules/astro/bin/astro.mjs'), 'build', '--root', join(root, mode)], { cwd: root, stdio: 'inherit', timeout: 180000 });
}
