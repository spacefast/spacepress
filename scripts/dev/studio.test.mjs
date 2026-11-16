import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownedState, publishPlugins, sourceDigest, watchSources, lock, siteAddress, addressPhp, withAddressLine, forward } from './studio.mjs';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';

test('local site ownership refuses foreign directories, copied receipts and redirected state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'first-dev-ownership-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  await mkdir(project);
  await mkdir(join(project, '.first/dev'), { recursive: true });
  await writeFile(join(project, '.first/dev/important'), 'foreign data');
  await assert.rejects(ownedState(project, true), /Unowned development directory/);
  assert.equal(await readFile(join(project, '.first/dev/important'), 'utf8'), 'foreign data');
  await rm(join(project, '.first/dev'), { recursive: true });
  const managed = await ownedState(project, true);
  assert.equal((await ownedState(project, false)).owner.site, join(project, '.first/dev/wordpress'));
  const other = join(root, 'other');
  await mkdir(join(other, '.first/dev'), { recursive: true });
  await writeFile(join(other, '.first/dev/owner.json'), await readFile(managed.marker));
  await assert.rejects(ownedState(other, true), /ownership does not match/);
  await rm(join(other, '.first/dev'), { recursive: true });
  await symlink(managed.state, join(other, '.first/dev'), 'junction');
  await assert.rejects(ownedState(other, true), /symbolic link/);
  const exited = spawn(process.execPath, ['-e', '']);
  await once(exited, 'exit');
  await writeFile(join(managed.state, 'session.json'), JSON.stringify({ pid: exited.pid }));
  const contenders = await Promise.allSettled([lock(managed.state), lock(managed.state)]);
  assert.equal(contenders.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(JSON.parse(await readFile(join(managed.state, 'session.json'), 'utf8')).pid, process.pid);
  await assert.rejects(lock(managed.state), /Another first dev command/);
  await contenders.find((attempt) => attempt.status === 'fulfilled').value();
});

test('publishing replaces managed plugins while retaining extra plugins and refusing collisions before writes', async (t) => {
  const project = await mkdtemp(join(tmpdir(), 'first-dev-plugins-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const managed = await ownedState(project, true);
  const plugins = join(managed.owner.site, 'wp-content/plugins');
  await mkdir(join(plugins, 'extra'), { recursive: true });
  await writeFile(join(plugins, 'extra/extra.php'), 'user-installed');
  const content = join(project, 'artifact');
  const source = join(content, 'plugins/first-app-test');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'first-app-test.php'), 'first build');
  await writeFile(join(source, 'stale.php'), 'old');
  const manifest = { app: 'test', plugins: { 'first-app-test': '0.3' }, dependencies: [], locales: null };
  await writeFile(join(content, 'first-manifest.json'), JSON.stringify(manifest));
  await publishPlugins(content, managed);
  await rm(join(source, 'stale.php'));
  await writeFile(join(source, 'first-app-test.php'), 'second build');
  await publishPlugins(content, managed);
  assert.equal(await readFile(join(plugins, 'first-app-test/first-app-test.php'), 'utf8'), 'second build');
  await assert.rejects(readFile(join(plugins, 'first-app-test/stale.php')), { code: 'ENOENT' });
  assert.equal(await readFile(join(plugins, 'extra/extra.php'), 'utf8'), 'user-installed');
  await writeFile(join(source, 'first-app-test.php'), 'must not be published');
  await writeFile(join(content, 'first-manifest.json'), JSON.stringify({ ...manifest, plugins: { ...manifest.plugins, extra: '1' } }));
  await assert.rejects(publishPlugins(content, managed), /not managed by First/);
  assert.equal(await readFile(join(plugins, 'first-app-test/first-app-test.php'), 'utf8'), 'second build');
});

test('watch inputs include imported TypeScript, public files and Markdown pages without reacting to generated output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'first-dev-watch-'));
  const project = join(root, 'project');
  let watcher;
  let observing = Promise.resolve();
  t.after(async () => {
    watcher?.close();
    await observing;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(project);
  await mkdir(join(project, 'first/lib'), { recursive: true });
  await mkdir(join(project, 'public'));
  await writeFile(join(project, 'first.config.ts'), 'config');
  await writeFile(join(project, 'first/lib/fields.ts'), 'first');
  const plugins = join(project, '.first/dev/wordpress/wp-content/plugins');
  const generated = join(plugins, 'first-app-watch');
  await mkdir(join(generated, 'blocks/deep/assets'), { recursive: true });
  await writeFile(join(generated, 'blocks/deep/assets/generated.ts'), 'initial output');
  const first = await sourceDigest(project);
  const updates = new EventEmitter();
  let observed = first;
  let watchError;
  const failed = (error) => { watchError = error; updates.emit('change'); };
  watcher = await watchSources(project, () => {
    observing = observing.then(async () => {
      observed = await sourceDigest(project);
      updates.emit('change');
    }).catch(failed);
  }, failed);
  async function waitForDigest(expected) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Source watcher did not observe the authored change')), 5000);
    try {
      while (observed !== expected) {
        if (watchError) throw watchError;
        await once(updates, 'change', { signal: controller.signal });
      }
      assert.equal(watchError, undefined);
    } finally { clearTimeout(timeout); }
  }
  await writeFile(join(project, 'first/lib/fields.ts'), 'second');
  const second = await sourceDigest(project);
  assert.notEqual(second, first);
  await waitForDigest(second);
  await mkdir(join(project, 'first/_generated'), { recursive: true });
  await writeFile(join(project, 'first/_generated/db.d.ts'), 'generated');
  for (let build = 0; build < 16; build++) {
    const staged = join(plugins, `.first-app-watch-${build}`);
    const previous = `${staged}.previous`;
    await mkdir(join(staged, 'blocks/deep/assets'), { recursive: true });
    await writeFile(join(staged, 'blocks/deep/assets/generated.ts'), `build ${build}`);
    await rename(generated, previous);
    await rename(staged, generated);
    await rm(previous, { recursive: true });
  }
  for (const ignored of ['.git', 'node_modules', 'first/node_modules', 'first/dist', 'first/_generated/client']) {
    const directory = join(project, ignored, 'nested/generated');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'output.ts'), 'generated');
    await rm(join(project, ignored), { recursive: true });
  }
  assert.equal(await sourceDigest(project), second);
  await writeFile(join(project, 'first/lib/fields.ts'), 'after generated plugin replacement');
  const afterBuild = await sourceDigest(project);
  assert.notEqual(afterBuild, second);
  await waitForDigest(afterBuild);
  await writeFile(join(project, 'public/card.html'), '<h1>Changed</h1>');
  const publicChange = await sourceDigest(project);
  assert.notEqual(publicChange, afterBuild);
  await waitForDigest(publicChange);
  const incoming = join(root, 'incoming');
  await mkdir(join(incoming, 'nested'), { recursive: true });
  await writeFile(join(incoming, 'nested/helper.ts'), 'new imported module');
  await rename(incoming, join(project, 'features'));
  const newDirectory = await sourceDigest(project);
  assert.notEqual(newDirectory, publicChange);
  await waitForDigest(newDirectory);
  await writeFile(join(project, 'features/nested/helper.ts'), 'edited imported module');
  const nestedChange = await sourceDigest(project);
  assert.notEqual(nestedChange, newDirectory);
  await waitForDigest(nestedChange);
  // A stylesheet or an image a page imports is a build input: its bytes name the file the page links.
  await mkdir(join(project, 'first/app'), { recursive: true });
  await writeFile(join(project, 'first/app/site.css'), 'body { margin: 0 }');
  const stylesheet = await sourceDigest(project);
  assert.notEqual(stylesheet, nestedChange);
  await waitForDigest(stylesheet);
  await writeFile(join(project, 'first/app/site.css'), 'body { margin: 1px }');
  const restyled = await sourceDigest(project);
  assert.notEqual(restyled, stylesheet);
  await waitForDigest(restyled);
  await writeFile(join(project, 'first/app/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const image = await sourceDigest(project);
  assert.notEqual(image, restyled);
  await waitForDigest(image);
  // A Markdown page is a build input; Markdown elsewhere (a README, notes) is not.
  await mkdir(join(project, 'first/app/about'), { recursive: true });
  await writeFile(join(project, 'first/app/about/page.md'), '# About');
  const markdownPage = await sourceDigest(project);
  assert.notEqual(markdownPage, image);
  await waitForDigest(markdownPage);
  await writeFile(join(project, 'first/app/about/page.md'), '# About us');
  const markdownEdit = await sourceDigest(project);
  assert.notEqual(markdownEdit, markdownPage);
  await waitForDigest(markdownEdit);
  await writeFile(join(project, 'README.md'), 'notes');
  await writeFile(join(project, 'first/app/about/notes.md'), 'notes');
  assert.equal(await sourceDigest(project), markdownEdit);
});

test('--url and --host name one address for WordPress and one for First to listen on, and refuse what names none', () => {
  // Neither: Studio's own http://localhost:<port>, and nothing but its loopback listener.
  assert.deepEqual(siteAddress(['--no-watch'], 8791), { url: null, listen: null });
  // --host: First listens there on the site's port, and that is the address WordPress writes.
  assert.deepEqual(siteAddress(['--host=10.0.0.24'], 8791), { url: 'http://10.0.0.24:8791', listen: '10.0.0.24' });
  assert.deepEqual(siteAddress(['--host=dev-box.lan'], 8791), { url: 'http://dev-box.lan:8791', listen: 'dev-box.lan' });
  assert.deepEqual(siteAddress(['--host=fd7a:115c::57'], 8791), { url: 'http://[fd7a:115c::57]:8791', listen: 'fd7a:115c::57' });
  // --url: a proxy in front serves another scheme, host or port; First listens nowhere new.
  assert.deepEqual(siteAddress(['--no-watch', '--url=https://box.example.ts.net:8443/'], 8791), { url: 'https://box.example.ts.net:8443', listen: null });
  assert.deepEqual(siteAddress(['--url=https://box.example.ts.net'], 8791), { url: 'https://box.example.ts.net', listen: null });
  // Both: listen on one address, announce another.
  assert.deepEqual(siteAddress(['--host=10.0.0.24', '--url=http://dev-box.lan:8791'], 8791), { url: 'http://dev-box.lan:8791', listen: '10.0.0.24' });
  for (const url of ['box.example.ts.net', 'ftp://box.example', 'https://box.example/blog', 'https://box.example/?a=1', 'https://user:secret@box.example', '']) {
    assert.throws(() => siteAddress([`--url=${url}`], 8791), /--url takes an address such as https:\/\/box\.example\.ts\.net:8443/, url);
  }
  // WordPress writes one address into every page: "all interfaces" names none.
  for (const host of ['0.0.0.0', '::', '*', '', 'a/b', 'http://10.0.0.24', '10.0.0.24:8791', 'a b']) {
    assert.throws(() => siteAddress([`--host=${host}`], 8791), /--host takes one address or name of this machine/, host);
  }
  // The listener lives in the first dev process, and --no-watch leaves none.
  assert.throws(() => siteAddress(['--no-watch', '--host=10.0.0.24'], 8791), /--host needs first dev to keep running/);
});

test('the address reaches WordPress before it loads, from one line in wp-config.php', () => {
  const php = addressPhp('https://box.example.ts.net:8443');
  assert.equal(php.split("'https://box.example.ts.net:8443'").length, 2);
  for (const option of ['pre_option_home', 'pre_option_siteurl']) assert.ok(php.includes(`'${option}'`), option);
  // Hooks set before wp-settings.php loads plugin.php, and through add_filter where WP-CLI loaded it first.
  assert.match(php, /function_exists\( 'add_filter' \)/);
  assert.match(php, /\$GLOBALS\['wp_filter'\]/);
  const config = "<?php\ndefine( 'WP_DEBUG', false );\n/* That's all, stop editing! Happy publishing. */\n\nif ( ! defined( 'ABSPATH' ) ) {\n\tdefine( 'ABSPATH', __DIR__ . '/' );\n}\n\n/** Sets up WordPress vars and included files. */\nrequire_once ABSPATH . 'wp-settings.php';\n";
  const patched = withAddressLine(config);
  const lines = patched.split('\n');
  const at = lines.findIndex((line) => line.includes('first-dev-address.php'));
  assert.match(lines[at], /^if \( is_file\( ABSPATH \. 'first-dev-address\.php' \) \) \{ require ABSPATH \. 'first-dev-address\.php'; \}/);
  assert.equal(lines[at + 1], "require_once ABSPATH . 'wp-settings.php';");
  assert.equal(patched.replace(`${lines[at]}\n`, ''), config);
  assert.equal(withAddressLine(patched), patched);
  assert.throws(() => withAddressLine("<?php\ndefine( 'WP_DEBUG', false );\n"), /wp-config\.php does not load wp-settings\.php/);
});

test('--host passes connections to the loopback listener untouched and lets go of them when it closes', { timeout: 20000 }, async (t) => {
  const body = '<a href="http://localhost:8791/">kept as WordPress wrote it</a>';
  const upstream = createServer((request, response) => response.end(`${request.headers.host} ${body}`));
  await new Promise((done) => upstream.listen(0, 'localhost', done));
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const relay = await forward('127.0.0.1', 0, upstream.address().port);
  const response = await fetch(`http://127.0.0.1:${relay.port}/`);
  assert.equal(await response.text(), `127.0.0.1:${relay.port} ${body}`);
  // A browser's idle connection (this one is kept alive) does not keep first dev from stopping.
  await relay.close();
  await assert.rejects(fetch(`http://127.0.0.1:${relay.port}/`));
  // An address that is not this machine's is refused with the address in the message.
  await assert.rejects(forward('192.0.2.1', 0, upstream.address().port), /Cannot listen on 192\.0\.2\.1:0/);
});
