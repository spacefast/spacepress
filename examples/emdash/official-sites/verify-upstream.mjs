import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root,'upstream.json'),'utf8'));
// Every vendored original keeps its pinned bytes.
for (const file of manifest.files) {
  const actual = createHash('sha256').update(await readFile(join(root,file.file))).digest('hex');
  if (actual !== file.sha256) throw new Error(`Pinned upstream source changed: ${file.file}`);
}
// And a template holds only upstream files besides its astro.config.mjs (which adds spEmdash()),
// its own package.json (replaced by this folder's) and, for blank, the SpacePress app's spacepress.config.ts:
// no adapter code next to the template, and no tsconfig `paths` redirecting its imports.
const pinned = new Set(manifest.files.map(file => file.file));
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path); else yield relative(root, path).split('\\').join('/');
  }
}
const allowed = new Set(['astro.config.mjs', 'spacepress.config.ts']);
const generated = /^(dist|node_modules|\.astro)$/;
for (const template of ['blank', 'starter', 'blog']) {
  for (const entry of await readdir(join(root, template), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (generated.test(entry.name) || entry.name === 'seed') continue;
      for await (const file of walk(join(root, template, entry.name))) {
        if (!pinned.has(file)) throw new Error(`${file} is not an upstream file: a template holds only the pinned originals`);
      }
    } else if (!allowed.has(entry.name) && !pinned.has(`${template}/${entry.name}`)) {
      throw new Error(`${template}/${entry.name} is not an upstream file: a template holds only the pinned originals`);
    }
  }
}
// The compiled reading-time algorithm is the official one, with its import renamed and its
// Unicode-property regex spelled out as code point ranges (SpacePress refuses property escapes).
const original = await readFile(join(root,'blog/src/utils/reading-time.ts'),'utf8');
const adapted = await readFile(join(root,'sp/backend/reading-time.ts'),'utf8');
const property = /^\s*\/\\p\{Script=Han\}.*\/gu;$/m;
const spelled = /^\s*\/\[\\u\{1100\}[^\n]*\/gu;$/m;
const strip = (text) => text.replace(/^\/\/ Han, Hangul[^\n]*\n(\/\/[^\n]*\n){2}/m, '');
if (!property.test(original) || !spelled.test(adapted)
  || strip(adapted).replace(spelled, '<CJK>') !== original.replace('from "emdash"','from "./host"').replace(property, '<CJK>')) {
  throw new Error('The compiled reading-time algorithm drifted from its official source.');
}
console.log(`Pinned source: ${manifest.files.length} original files match ${manifest.commit}; the templates hold nothing else but their astro.config.mjs.`);
