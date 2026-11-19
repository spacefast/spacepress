import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromiumPath } from '../../../tests/differential/client/chromium.mjs';
import { buildFrontend } from '../src/index.mjs';

const require = createRequire(new URL('../../../tests/differential/client/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const compiler = process.env.TP_BIN ?? fileURLToPath(new URL('../../../target/debug/typedpress', import.meta.url));
const exec = promisify(execFile);

test('React Fast Refresh preserves state on a real Studio WordPress page', { timeout: 300000 }, async (t) => {
  const root = await mkdtemp(fileURLToPath(new URL('./.frontend-refresh-', import.meta.url)));
  let session, browser;
  t.after(async () => {
    await browser?.close();
    if (session && session.exitCode === null) {
      const exited = once(session, 'exit');
      await exec(compiler, ['dev', 'stop', root], { timeout: 60000 });
      await exited;
    }
    const site = join(root, '.tp/dev/wordpress');
    const studio = (...args) => exec('npx', ['--yes', '--package', 'wp-studio@2.2.0', '--', 'studio', ...args], { timeout: 60000 });
    const { stdout } = await studio('list', '--format=json');
    if (JSON.parse(stdout).some((entry) => entry.path === site)) await studio('delete', site, '--no-files', '--format=json');
    await rm(root, { recursive: true, force: true });
  });

  const component = (label) => `
    import { useState } from 'react';
    export default function Counter() {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>${label} {count}</button>;
    }
  `;
  const files = {
    'package.json': JSON.stringify({ name: 'refresh-fixture', type: 'module', devDependencies: {
      '@typedpress/frontend': '0.1.0', react: '19.2.8', 'react-dom': '19.2.8',
    } }),
    'typedpress.config.ts': `
      import { defineConfig } from 'typedpress';
      export default defineConfig({ name: 'refresh-fixture', admin: false });
    `,
    'tp/app/page.tsx': `
      import { frontend } from '../_generated/frontend';
      export const metadata = frontend.main;
      export default function Page() { return <main><div id="react" /></main>; }
    `,
    'browser/index.ts': `
      import { createElement } from 'react';
      import { createRoot } from 'react-dom/client';
      import Counter from './Counter.tsx';
      createRoot(document.querySelector('#react')!).render(createElement(Counter));
    `,
    'browser/Counter.tsx': component('Count'),
  };
  for (const [name, contents] of Object.entries(files)) {
    const file = join(root, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  await mkdir(join(root, 'node_modules/@typedpress'), { recursive: true });
  await symlink(fileURLToPath(new URL('..', import.meta.url)), join(root, 'node_modules/@typedpress/frontend'), 'junction');
  await buildFrontend({ root });
  await writeFile(join(root, '.tp/refresh-private.txt'), 'Local state');
  const publicAssets = join(root, 'public/typedpress-assets');
  for (const file of await readdir(publicAssets, { recursive: true })) {
    if (file.endsWith('.js')) assert.doesNotMatch(await readFile(join(publicAssets, file), 'utf8'), /@vite\/client|@react-refresh|__tp_vite/);
  }

  const changed = new EventEmitter();
  let output = '';
  const port = process.env.TP_DEV_TEST_PORT ?? '8813';
  session = spawn(compiler, ['dev', root, '--foreground', '--port', port], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [session.stdout, session.stderr]) stream.on('data', (chunk) => { output += chunk; changed.emit('output'); });
  session.on('exit', () => changed.emit('output'));
  async function waitForOutput(text) {
    const signal = AbortSignal.timeout(120000);
    while (!output.includes(text)) {
      assert.equal(session.exitCode, null, output);
      await once(changed, 'output', { signal }).catch((error) => { throw new Error(`Waiting for ${text}:\n${output}`, { cause: error }); });
    }
  }
  await waitForOutput('Watching config');
  assert.ok(output.includes(`Website:   http://localhost:${port}/`), 'Studio selected a different port');

  browser = await chromium.launch({ executablePath: chromiumPath() });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://localhost:${port}`);
  try {
    const launcher = await page.locator('script[src*="/__tp_vite/"]').getAttribute('src');
    const privateState = await fetch(new URL('/.tp/refresh-private.txt', launcher));
    assert.equal(privateState.status, 403);
    await page.getByRole('button', { name: 'Count 0', exact: true }).click();
    await page.getByRole('button', { name: 'Count 1', exact: true }).waitFor();
    await page.evaluate(() => { window.refreshProof = 'same document'; });
    await writeFile(join(root, 'browser/Counter.tsx'), component('Updated count'));
    await page.getByRole('button', { name: 'Updated count 1', exact: true }).waitFor();
    await waitForOutput('Updated.');
    assert.equal(await page.evaluate(() => window.refreshProof), 'same document');
    await page.getByRole('button', { name: 'Updated count 1', exact: true }).click();
    await page.getByRole('button', { name: 'Updated count 2', exact: true }).waitFor();
  } catch (error) {
    throw new Error(`${error.message}\nBrowser: ${errors.join('\n')}\n${output}`, { cause: error });
  }
});
