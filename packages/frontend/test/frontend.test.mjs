import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildFrontend } from '../src/index.mjs';

async function fixture(t) {
  const project = await mkdtemp(fileURLToPath(new URL('../test/.frontend-', import.meta.url)));
  t.after(() => rm(project, { recursive: true, force: true }));
  for (const directory of ['browser', 'src', 'tp/app']) {
    await mkdir(path.join(project, directory), { recursive: true });
  }
  return project;
}

test('builds browser entries and native Tailwind utilities with route-level assets', async (t) => {
  const root = await fixture(t);
  const file = (name, content) => writeFile(path.join(root, name), content);
  await file('tp/app/page.tsx', '<main className="text-[19px]" />');
  await file('browser/site.css', '@import "tailwindcss" source(none);\n@source "../tp/app";');
  await file('src/label.ts', 'export const label = "from the alias";');
  await file('browser/index.ts', 'import "./site.css";\nimport { label } from "@/label";\ndocument.title = label;');
  await file('browser/other.ts', 'document.title = "other route";');
  await file('browser/style-only.css', '.standalone { color: red; }');

  const entries = { main: 'browser/index.ts', other: 'browser/other.ts', style: 'browser/style-only.css' };
  const first = await buildFrontend({ root, entries });
  assert.deepEqual(first.main.links.map(({ rel }) => rel), ['stylesheet', 'modulepreload']);
  assert.deepEqual(first.other.links.map(({ rel }) => rel), ['modulepreload']);
  assert.deepEqual(first.style.scripts, []);
  assert.equal(first.style.links.length, 1);

  const asset = (url) => path.join(root, 'public', url);
  assert.match(await readFile(asset(first.main.links[1].href), 'utf8'), /from the alias/);
  assert.match(await readFile(asset(first.main.links[0].href), 'utf8'), /font-size:19px/);
  assert.deepEqual(await buildFrontend({ root, entries }), first);

  await file('browser/index.ts', 'import "./site.css";\ndocument.title = "new version";');
  const second = await buildFrontend({ root, entries });
  assert.notEqual(second.main.scripts[0], first.main.scripts[0]);
  await assert.rejects(readFile(asset(first.main.scripts[0])), { code: 'ENOENT' });
  assert.equal(second.other.scripts[0], first.other.scripts[0]);
});

test('preserves an authored directory using the generated output name', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'browser/index.ts'), '');
  const directory = path.join(root, 'public/typedpress-assets');
  await mkdir(directory, { recursive: true });
  const asset = path.join(directory, 'site.txt');
  await writeFile(asset, 'authored');
  await assert.rejects(buildFrontend({ root }), /reserved for generated frontend files/);
  assert.equal(await readFile(asset, 'utf8'), 'authored');
});

test('preserves authored metadata before producing browser files', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'browser/index.ts'), '');
  await mkdir(path.join(root, 'tp/_generated'));
  const metadata = path.join(root, 'tp/_generated/frontend.ts');
  await writeFile(metadata, 'export const frontend = {};');
  await assert.rejects(buildFrontend({ root }), /reserved for generated metadata/);
  assert.equal(await readFile(metadata, 'utf8'), 'export const frontend = {};');
});

test('serves frontend assets only on the route that uses them', { skip: !process.env.TP_BIN }, async (t) => {
  const root = await fixture(t);
  const file = (name, content) => writeFile(path.join(root, name), content);
  await file('typedpress.config.ts', 'import { defineConfig } from "typedpress"; export default defineConfig({ name: "frontend-test" });');
  await mkdir(path.join(root, 'tp/app/(site)'));
  await file('tp/app/(site)/layout.tsx', 'import type { LayoutProps } from "typedpress/app"; import "./site.css"; import { frontend } from "../../_generated/frontend"; export const metadata = frontend.main; export default function Layout({ children }: LayoutProps) { return <>{children}</>; }');
  await file('tp/app/(site)/page.tsx', 'import "./site.css"; import { frontend } from "../../_generated/frontend"; export const metadata = frontend.main; export default function Page() { return <h1 className="text-[19px]">Native page</h1>; }');
  await mkdir(path.join(root, 'tp/app/plain'));
  await file('tp/app/plain/page.tsx', 'export default function Plain() { return <h1>Plain page</h1>; }');
  await file('browser/site.css', '.browser { color: red; }');
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- ${'fixture '.repeat(600)} --><circle r="5"/></svg>`;
  await file('tp/app/(site)/icon.svg', icon);
  await file('tp/app/(site)/site.css', '@import "tailwindcss" source(none);\n@source "./";\nh1 { background: url("./icon.svg"); }');
  await file('package.json', '{"devDependencies":{"@typedpress/frontend":"0.1.0"}}');
  await mkdir(path.join(root, 'node_modules/@typedpress'), { recursive: true });
  await symlink(fileURLToPath(new URL('../', import.meta.url)), path.join(root, 'node_modules/@typedpress/frontend'), 'junction');
  await file('browser/index.ts', 'import "./site.css"; document.title = "Browser entry";');

  const command = fileURLToPath(new URL('../bin/typedpress-frontend.mjs', import.meta.url));
  execFileSync(process.execPath, [command, root]);
  execFileSync(process.env.TP_BIN, ['build', root]);
  const pageFile = 'tp/app/(site)/page.tsx';
  await file(pageFile, (await readFile(path.join(root, pageFile), 'utf8')).replace('text-[19px]', 'text-[23px]'));
  const capture = path.join(root, 'capture');
  execFileSync(process.env.TP_BIN, ['sources', root, '--out', capture]);
  const hosted = path.join(root, 'hosted');
  execFileSync(process.env.TP_BIN, ['compile-sources', capture, hosted, capture], { env: { ...process.env, PATH: '' } });
  assert.throws(
    () => execFileSync(process.env.TP_BIN, ['compile-sources', capture, path.join(root, 'incomplete'), root + '/missing-assets'], { stdio: 'pipe' }),
    /frontend stylesheet .* is missing from public/,
  );
  const runner = fileURLToPath(new URL('../../../tests/php/wp.php', import.meta.url));
  const child = spawn('php', [runner, 'serve', path.join(root, 'tp/dist/wp-content')], {
    env: { ...process.env, TP_WP_THEMES: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => child.kill('SIGTERM'));
  const reader = createInterface({ input: child.stdout });
  const [line] = await Promise.race([
    once(reader, 'line'),
    once(child, 'exit').then(([code]) => { throw new Error(`WordPress fixture exited with ${code}`); }),
  ]);
  reader.close();
  const { url } = JSON.parse(line);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, />Native page<\/h1>/);
  const [script, style] = [
    html.match(/(?:src)=["']([^"']+\/typedpress-assets\/[^"']+\.js(?:\?[^"']*)?)["']/)?.[1],
    html.match(/(?:href)=["']([^"']+\/typedpress-styles\/[^"']+\.css(?:\?[^"']*)?)["']/)?.[1],
  ];
  assert.ok(script && style, 'The route head must link its generated module and stylesheet');
  assert.equal(html.split(style).length - 1, 1, 'The layout and page must share one stylesheet link');
  const [js, css] = await Promise.all([fetch(script), fetch(style)]);
  assert.equal(js.status, 200);
  assert.equal(css.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const preload = html.match(/<link rel="modulepreload" href="([^"]+)"/)?.[1];
  assert.ok(preload, 'The browser can preload the canonical module while loading the launcher');
  const [launchCode, entry] = await Promise.all([js.text(), fetch(preload)]);
  const relativeImport = JSON.parse(launchCode.match(/^import (".+");/)[1]);
  assert.equal(new URL(relativeImport, script).href, preload);
  assert.equal(entry.status, 200);
  assert.match(await entry.text(), /Browser entry/);
  const cssText = await css.text();
  assert.match(cssText, /font-size:19px/);
  const iconName = cssText.match(/url\(["']?(\.\/)?(icon-[^)"']+\.svg)/)?.[2];
  assert.ok(iconName, 'The CSS keeps a relative URL to the emitted image');
  const emittedIcon = await fetch(new URL(iconName, style));
  assert.equal(emittedIcon.status, 200);
  assert.equal(await emittedIcon.text(), icon);
  const hostedAssets = path.join(hosted, 'plugins/typedpress-app-frontend-test/public/typedpress-styles/assets');
  const hostedStyles = (await readdir(hostedAssets)).filter((file) => file.endsWith('.css'));
  assert.equal(hostedStyles.length, 1);
  assert.match(await readFile(path.join(hostedAssets, hostedStyles[0]), 'utf8'), /font-size:23px/);

  const plain = await fetch(new URL('/plain/', url));
  assert.equal(plain.status, 200);
  assert.doesNotMatch(await plain.text(), /typedpress-(?:assets|styles)/);

  await file('package.json', '{}');
  await file('tp/app/(site)/site.css', 'h1 { font-size: 31px; }');
  const nativeCapture = path.join(root, 'native-capture');
  const nativeOutput = path.join(root, 'native-output');
  execFileSync(process.env.TP_BIN, ['sources', root, '--out', nativeCapture]);
  execFileSync(process.env.TP_BIN, ['compile-sources', nativeCapture, nativeOutput, nativeCapture]);
  const nativeAssets = path.join(nativeOutput, 'plugins/typedpress-app-frontend-test/tp/app/assets');
  const nativeStyle = (await readdir(nativeAssets)).find((file) => file.endsWith('.css'));
  assert.match(await readFile(path.join(nativeAssets, nativeStyle), 'utf8'), /font-size: 31px/);
});
