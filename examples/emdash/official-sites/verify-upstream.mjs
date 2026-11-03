import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root,'upstream.json'),'utf8'));
// Generated-source drift guard: every vendored original must retain its pinned bytes.
for (const file of manifest.files) {
  const actual = createHash('sha256').update(await readFile(join(root,file.file))).digest('hex');
  if (actual !== file.sha256) throw new Error(`Pinned upstream source changed: ${file.file}`);
}
const original = await readFile(join(root,'blog/src/utils/reading-time.ts'),'utf8');
const adapted = await readFile(join(root,'backend/reading-time.ts'),'utf8');
if (adapted !== original.replace('from "emdash"','from "./host"')) throw new Error('The compiled reading-time algorithm drifted from its official source.');
console.log(`Pinned source: ${manifest.files.length} original files match ${manifest.commit}.`);
