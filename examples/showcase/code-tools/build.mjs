import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export async function buildSourceLab({outdir}) {
  await fs.mkdir(outdir, {recursive: true});
  await build({
    absWorkingDir: here,
    entryPoints: [path.join(here, '../public/source-lab.js')],
    outfile: path.join(outdir, 'source-lab.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    legalComments: 'eof',
    nodePaths: [path.join(here, 'node_modules')],
    alias: {
      'shiki/langs': path.join(here, 'limited-languages.js'),
      '@pierre/theming/themes': path.join(here, 'limited-themes.js'),
    },
  });
  await build({
    entryPoints: [path.join(here, '../../../site/src/lib/compiler.ts')],
    outfile: path.join(outdir, 'compiler.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
  });
  await fs.copyFile(path.join(here, 'source-compiler-worker.js'), path.join(outdir, 'source-compiler-worker.js'));
  await fs.copyFile(path.join(here, '../public/source-lab.css'), path.join(outdir, 'source-lab.css'));
  await fs.writeFile(path.join(outdir, 'code-notices.txt'), [
    'Zero showcase source lab',
    '@pierre/diffs 1.6.2 — Apache-2.0 — https://diffs.com',
    'Shiki 4.3.0 — MIT — https://shiki.style',
    'Dependency licenses follow. Exact versions: examples/showcase/code-tools/package-lock.json.',
    '',
  ].join('\n'));
  const notices = [];
  const lock = JSON.parse(await fs.readFile(path.join(here, 'package-lock.json'), 'utf8'));
  for (const relative of Object.keys(lock.packages).filter(Boolean).sort()) {
    const base = path.join(here, relative);
    let entries;
    try { entries = await fs.readdir(base); } catch { continue; }
    const metadata = JSON.parse(await fs.readFile(path.join(base, 'package.json'), 'utf8'));
    const license = entries.find((name) => /^licen[cs]e(?:\.|$)/i.test(name));
    notices.push(`\n--- ${metadata.name} ${metadata.version} (${metadata.license || 'see package'}) ---\n${license ? await fs.readFile(path.join(base, license), 'utf8') : 'License: ' + (metadata.license || 'see package metadata')}`);
  }
  await fs.appendFile(path.join(outdir, 'code-notices.txt'), notices.join('\n'));
  console.log(`Built offline source lab, compiler wrapper and dependency notices into ${outdir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node examples/showcase/code-tools/build.mjs <public-directory>');
  await buildSourceLab({outdir: path.resolve(process.argv[2])});
}
