import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
for (const mode of ['blank','starter','blog']) execFileSync(process.execPath, [join(root, 'node_modules/astro/bin/astro.mjs'), 'check', '--root', join(root, mode)], { cwd: root, stdio: 'inherit', timeout: 180000 });
