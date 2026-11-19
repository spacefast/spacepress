import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const plugin = `<?php
add_filter('script_module_loader_src', static function ($src, $id) {
    if (!str_starts_with($id, 'typedpress-app-script-')) return $src;
    $path = wp_parse_url($src, PHP_URL_PATH);
    if (!is_string($path) || strtok($src, '?#') !== home_url($path)) return $src;
    $state = __DIR__ . '/typedpress-frontend/launchers.json';
    if (!is_readable($state)) return $src;
    $launchers = json_decode(file_get_contents($state), true);
    return $launchers[$path] ?? $src;
}, 10, 2);
`;

export async function startFrontend(project, managed, { site, host, watch, write }) {
  const mu = join(managed.owner.site, 'wp-content/mu-plugins/typedpress-frontend.php');
  const state = join(dirname(mu), 'typedpress-frontend/launchers.json');
  if (managed.owner.frontendMu) await write(state, null);
  if (!watch) return;

  const require = createRequire(join(project, 'package.json'));
  let module;
  try { module = require.resolve('@typedpress/frontend'); }
  catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') return;
    throw error;
  }
  let settings;
  try { settings = JSON.parse(await readFile(join(project, '.tp/frontend-dev.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!Object.keys(settings.launchers).length) return;

  if (!managed.owner.frontendMu && await access(mu).then(() => true, () => false)) {
    throw new Error('typedpress-frontend.php already exists and is not managed by TypedPress.');
  }
  await mkdir(dirname(state), { recursive: true });
  await writeFile(mu, plugin);
  managed.owner.frontendMu = true;
  await write(managed.marker, managed.owner);
  // Vite reads NODE_ENV to choose React's development runtime and enable Refresh.
  process.env.NODE_ENV = 'development';
  const { serveFrontend } = await import(pathToFileURL(module));
  const server = await serveFrontend({ ...settings, root: project, host, site });
  try {
    await write(state, server.launchers);
    return {
      async close() {
        try { await write(state, null); }
        finally { await server.close(); }
      },
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}
