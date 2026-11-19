import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildFrontend } from '../src/index.mjs';

const require = createRequire(new URL('../../../tests/differential/client/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const compiler = process.env.TP_BIN ?? fileURLToPath(new URL('../../../target/debug/typedpress', import.meta.url));

test('one WordPress route loads interactive React, Preact, Solid and Vue components', async (t) => {
  const root = await mkdtemp(fileURLToPath(new URL('./.frontend-frameworks-', import.meta.url)));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'typedpress.config.ts': `
      import { defineConfig } from 'typedpress';
      export default defineConfig({ name: 'mixed-frameworks' });
    `,
    'tp/app/page.tsx': `
      import { frontend } from '../_generated/frontend';
      export const metadata = frontend.main;
      export default function Page() {
        return <main><div id="react" /><div id="preact" /><div id="solid" /><div id="vue" /></main>;
      }
    `,
    'browser/index.ts': `
      import './react.tsx';
      import './preact.tsx?fixture=preact';
      import preactSource from './preact.tsx?raw';
      import './solid.tsx?fixture=solid';
      import { createApp } from 'vue';
      import Counter from './Counter.vue';
      if (!preactSource.includes('<Counter />')) throw new Error('Vite did not preserve the raw source.');
      createApp(Counter).mount('#vue');
    `,
    'browser/react.tsx': `
      import { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      function Counter() {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(count + 1)}>React {count}</button>;
      }
      createRoot(document.querySelector('#react')!).render(<Counter />);
    `,
    'browser/preact.tsx': `
      import { render } from 'preact';
      import { useState } from 'preact/hooks';
      function Counter() {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(count + 1)}>Preact {count}</button>;
      }
      render(<Counter />, document.querySelector('#preact')!);
    `,
    'browser/solid.tsx': `
      import { createSignal } from 'solid-js';
      import { render } from 'solid-js/web';
      function Counter() {
        const [count, setCount] = createSignal(0);
        return <button onClick={() => setCount(count() + 1)}>Solid {count()}</button>;
      }
      render(() => <Counter />, document.querySelector('#solid')!);
    `,
    'browser/Counter.vue': `
      <script setup lang="ts">
        import { ref } from 'vue';
        const count = ref<number>(0);
      </script>
      <template><button @click="count++">Vue {{ count }}</button></template>
      <style scoped>button { color: rgb(31, 71, 131); }</style>
    `,
  };
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  const frameworks = { preact: ['browser/preact.tsx'], solid: ['browser/solid.tsx'], vue: true };
  await assert.rejects(buildFrontend({ root, frameworks: { ...frameworks, solid: ['browser/*.tsx'] } }), /must match only one/);
  await buildFrontend({ root, frameworks });
  execFileSync(compiler, ['build', root]);

  const runner = fileURLToPath(new URL('../../../tests/php/wp.php', import.meta.url));
  const server = spawn('php', [runner, 'serve', path.join(root, 'tp/dist/wp-content')], {
    env: { ...process.env, TP_WP_THEMES: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => server.kill('SIGTERM'));
  const reader = createInterface({ input: server.stdout });
  const [line] = await Promise.race([
    once(reader, 'line'),
    once(server, 'exit').then(([code]) => { throw new Error(`WordPress fixture exited with ${code}`); }),
  ]);
  reader.close();
  const { url } = JSON.parse(line);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  for (const framework of ['React', 'Preact', 'Solid', 'Vue']) {
    const button = page.getByRole('button', { name: `${framework} 0`, exact: true });
    await button.click();
    await page.getByRole('button', { name: `${framework} 1`, exact: true }).waitFor();
  }
  const color = await page.getByRole('button', { name: 'Vue 1', exact: true }).evaluate((button) => getComputedStyle(button).color);
  assert.equal(color, 'rgb(31, 71, 131)');
  assert.deepEqual(errors, []);
});
