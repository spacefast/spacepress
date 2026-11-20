import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
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
    if (session && session.exitCode === null && session.signalCode === null) {
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
      import './site.css';
      import Counter from './Counter.tsx';
      createRoot(document.querySelector('#react')!).render(createElement(Counter));
    `,
    'browser/site.css': 'button { color: rgb(1, 2, 3); }\nmain { outline: 3px solid rgb(4, 5, 6); --tp-removed-rule: 1; }\n',
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

  const port = process.env.TP_DEV_TEST_PORT ?? '8813';
  const local = `http://localhost:${port}`;
  let output = '';
  const changed = new EventEmitter();
  async function waitForOutput(text) {
    const signal = AbortSignal.timeout(120000);
    while (!output.includes(text)) {
      assert.equal(session.exitCode, null, output);
      await once(changed, 'output', { signal }).catch((error) => { throw new Error(`Waiting for ${text}:\n${output}`, { cause: error }); });
    }
  }
  // A person's own environment: dev must hand it to Studio and the compiler as it is.
  const start = async (...flags) => {
    output = '';
    session = spawn(compiler, ['dev', root, '--foreground', '--port', port, ...flags], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test' } });
    for (const stream of [session.stdout, session.stderr]) stream.on('data', (chunk) => { output += chunk; changed.emit('output'); });
    session.on('exit', () => changed.emit('output'));
    await waitForOutput('Watching config');
  };
  const online = async () => JSON.parse((await exec(compiler, ['dev', 'status', root], { timeout: 60000 })).stdout).isOnline;
  const stop = async () => {
    const exited = once(session, 'exit');
    await exec(compiler, ['dev', 'stop', root], { timeout: 60000 });
    await exited;
  };
  const bundle = async () => {
    let text = '';
    for (const file of await readdir(publicAssets, { recursive: true })) {
      if (/\.(?:js|css)$/.test(file)) text += await readFile(join(publicAssets, file), 'utf8');
    }
    return text;
  };

  await start();
  assert.ok(output.includes(`Website:   ${local}/`), 'Studio selected a different port');
  browser = await chromium.launch({ executablePath: chromiumPath() });
  const errors = [];
  const open = async (address) => {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(address);
    return page;
  };
  const builtLinks = (page) => page.locator('link[href*="/typedpress-assets/"]').count();
  try {
    let page = await open(local);
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

    // The page arrived with the built bundle's stylesheet and preload. Vite's own take their
    // place, so a rule deleted from the source stops applying without a reload.
    await page.waitForFunction(() => document.querySelectorAll('link[href*="/typedpress-assets/"]').length === 0);
    const outline = () => page.locator('main').evaluate((main) => getComputedStyle(main).outlineStyle);
    assert.equal(await outline(), 'solid');
    await writeFile(join(root, 'browser/site.css'), 'button { color: rgb(1, 2, 3); }\n');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('main')).outlineStyle === 'none');
    assert.equal(await page.evaluate(() => window.refreshProof), 'same document');
    await page.close();

    // While Vite serves the entries, dev leaves the built bundle as it was. A build afterwards
    // must not ship that one: `typedpress build` builds the entries again first.
    const stale = await bundle();
    assert.doesNotMatch(stale, /Updated count/);
    assert.match(stale, /--tp-removed-rule/);
    // A stop signal to the watcher (the pid `typedpress dev status --json` reports) runs dev's own
    // cleanup: Vite takes no signal handler of its own, so WordPress stops and the command exits 0.
    const { pid } = JSON.parse((await exec(compiler, ['dev', 'status', root, '--json'], { timeout: 60000 })).stdout);
    assert.ok(Number.isSafeInteger(pid) && pid !== session.pid, 'the watcher is on record');
    const killed = once(session, 'exit');
    process.kill(pid, 'SIGTERM');
    assert.deepEqual(await killed, [0, null], output);
    assert.equal(await online(), false, 'WordPress still runs after SIGTERM');

    await exec(compiler, ['build', root, '--out', join(root, 'tp/dist/check')], { timeout: 120000, env: { ...process.env, NODE_ENV: 'test' } });
    const rebuilt = await bundle();
    assert.match(rebuilt, /Updated count/);
    assert.doesNotMatch(rebuilt, /--tp-removed-rule/);
    assert.doesNotMatch(rebuilt, /@vite\/client|@react-refresh|__tp_vite/);

    // Opened from another machine through a proxy that passes only WordPress on (`tailscale serve`
    // with one mapping): Vite is not reachable there, so the page loads the built entry, which
    // runs, and dev says Fast Refresh is off.
    const owner = JSON.parse(await readFile(join(root, '.tp/dev/owner.json'), 'utf8'));
    // 127.0.0.2 stands for the other machine's name for this one: not loopback by name, and not
    // where Vite listens. `routeVite` passes /__tp_vite/ on to Vite, sockets included.
    const proxy = (routeVite) => new Promise((done) => {
      const target = (url) => (routeVite && url.startsWith('/__tp_vite/') ? owner.frontendPort : Number(port));
      const relay = createServer((incoming, outgoing) => {
        const upstream = request({ host: 'localhost', port: target(incoming.url), path: incoming.url, method: incoming.method, headers: incoming.headers }, (answer) => {
          outgoing.writeHead(answer.statusCode, answer.headers);
          answer.pipe(outgoing);
        });
        upstream.on('error', () => outgoing.destroy());
        incoming.pipe(upstream);
      });
      relay.on('upgrade', (incoming, socket, head) => {
        const upstream = connect(target(incoming.url), 'localhost', () => {
          upstream.write(`${incoming.method} ${incoming.url} HTTP/1.1\r\n${Object.entries(incoming.headers).map(([name, value]) => `${name}: ${value}\r\n`).join('')}\r\n`);
          upstream.write(head);
          socket.pipe(upstream).pipe(socket);
        });
        for (const end of [socket, upstream]) end.on('error', () => { socket.destroy(); upstream.destroy(); });
      });
      relay.listen(0, '127.0.0.2', () => done(relay));
    });
    const shut = (relay) => new Promise((done) => { relay.close(done); relay.closeAllConnections(); });

    const plain = await proxy(false);
    t.after(() => shut(plain));
    let announced = `http://127.0.0.2:${plain.address().port}`;
    await start('--url', announced);
    assert.match(output, new RegExp(`Fast Refresh is off: ${announced} does not pass /__tp_vite/ on to Vite`));
    page = await open(announced);
    await page.getByRole('button', { name: 'Updated count 0', exact: true }).click();
    await page.getByRole('button', { name: 'Updated count 1', exact: true }).waitFor();
    assert.equal(await page.locator('script[src*="/__tp_vite/"]').count(), 0);
    assert.ok(await builtLinks(page) > 0);
    // With Vite out of reach, a save builds the bundle again, so a reload shows the edit.
    await writeFile(join(root, 'browser/Counter.tsx'), component('Built again'));
    await waitForOutput('Updated.');
    assert.match(await bundle(), /Built again/);
    const rebuiltButton = page.getByRole('button', { name: 'Built again 0', exact: true });
    for (let attempt = 0; attempt < 20 && !await rebuiltButton.isVisible(); attempt++) {
      await new Promise((done) => setTimeout(done, 500));
      await page.reload();
    }
    await rebuiltButton.waitFor();
    await page.close();
    await stop();
    await shut(plain);

    // The same address with /__tp_vite/ passed on to Vite: everything the page loads comes from
    // the site's own address, and Fast Refresh keeps state there too.
    const routed = await proxy(true);
    t.after(() => shut(routed));
    announced = `http://127.0.0.2:${routed.address().port}`;
    await start('--url', announced);
    assert.doesNotMatch(output, /Fast Refresh is off/);
    page = await browser.newPage();
    const asked = [];
    page.on('request', (sent) => asked.push(sent.url()));
    page.on('websocket', (socket) => asked.push(socket.url().replace(/^ws/, 'http')));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(announced);
    assert.match(await page.locator('script[src*="/__tp_vite/"]').getAttribute('src'), new RegExp(`^${announced}/__tp_vite/`));
    await page.getByRole('button', { name: 'Built again 0', exact: true }).click();
    await page.getByRole('button', { name: 'Built again 1', exact: true }).waitFor();
    await page.evaluate(() => { window.refreshProof = 'same document'; });
    await writeFile(join(root, 'browser/Counter.tsx'), component('Through the proxy'));
    await page.getByRole('button', { name: 'Through the proxy 1', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.refreshProof), 'same document');
    assert.deepEqual(asked.filter((url) => /^https?:/.test(url) && !url.startsWith(`${announced}/`)), []);
    await page.close();
    await stop();
    assert.equal(await online(), false);
  } catch (error) {
    throw new Error(`${error.message}\nBrowser: ${errors.join('\n')}\n${output}`, { cause: error });
  }
});
