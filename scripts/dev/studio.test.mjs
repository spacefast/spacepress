import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ownedState, publishPlugins, pluginPrints, sourceDigest, watchSources, lock, siteAddress, listenAddress, addressPhp, withAddressLine, settingsOffset, forward, wordpressVersion, detachedReport, DEV_PLUGIN } from './studio.mjs';
import { liveUpdates } from './live.mjs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { viteAddress, launcherMap, FRONTEND_PLUGIN } from './frontend.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

test('native WordPress creation selects the stable update offered from the floor, never a pre-release', async () => {
  const offered = async (offers) => ({ ok: true, json: async () => ({ offers }) });
  assert.equal(await wordpressVersion(async (url) => {
    // The stable channel: the beta channel would offer 7.2's release candidates from 7.1.
    assert.match(url, /\?version=7\.1$/);
    return offered([{ response: 'upgrade', version: '7.1.4' }, { response: 'autoupdate', version: '7.1.4' }]);
  }), '7.1.4');
  assert.equal(await wordpressVersion(() => offered([{ response: 'latest', version: '7.1' }])), '7.1');
  assert.equal(await wordpressVersion(async () => { throw new Error('offline'); }), '7.1');
});

test('the CLI runs through a symlink with and without Node path preservation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'typedpress-studio-entry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const link = join(root, 'studio.mjs');
  await symlink(fileURLToPath(new URL('./studio.mjs', import.meta.url)), link);
  for (const flags of [[], ['--preserve-symlinks-main']]) {
    assert.throws(() => execFileSync(process.execPath, [...flags, link, 'start', join(root, 'missing')], { encoding: 'utf8' }),
      (error) => error.status === 1 && /typedpress dev:.*ENOENT/.test(error.stderr));
  }
});

test('a failed export startup exits even while its parent keeps stdin open', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'typedpress-studio-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const studio = join(root, 'wp-studio');
  await mkdir(bin); await mkdir(join(studio, 'dist/cli'), { recursive: true });
  await writeFile(join(studio, 'package.json'), JSON.stringify({ name: 'wp-studio', version: '2.2.0' }));
  await writeFile(join(studio, 'dist/cli/main.mjs'), 'console.error("startup refused"); process.exit(7);');
  const fetchStub = 'data:text/javascript,' + encodeURIComponent('globalThis.fetch = async () => ({ ok: true, json: async () => ({ offers: [] }) });');
  const child = spawn(process.execPath, ['--import', fetchStub, fileURLToPath(new URL('./studio.mjs', import.meta.url)), 'export', root], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ['pipe', 'ignore', 'pipe'],
  });
  t.after(() => child.kill('SIGKILL'));
  let stderr = ''; child.stderr.on('data', (data) => { stderr += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  const [code, signal] = await once(child, 'exit'); clearTimeout(timer);
  assert.equal(signal, null, stderr); assert.equal(code, 1, stderr);
  assert.match(stderr, /startup refused/);
});

test('a preserved file symlink gives Studio the physical setup file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'typedpress-studio-setup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const studio = join(root, 'wp-studio');
  const content = join(root, 'content');
  await mkdir(bin); await mkdir(content); await mkdir(join(studio, 'dist/cli'), { recursive: true });
  await writeFile(join(studio, 'package.json'), JSON.stringify({ name: 'wp-studio', version: '2.2.0' }));
  await writeFile(join(studio, 'dist/cli/main.mjs'), `
    import { readFileSync } from 'node:fs';
    if (process.argv[2] === 'wp' && process.argv[3] === 'eval-file') {
      readFileSync(process.argv[4]);
      console.error('physical setup file read'); process.exit(7);
    }
  `);
  await writeFile(join(content, 'typedpress-manifest.json'), JSON.stringify({ app: 'test', plugins: {}, dependencies: [], locales: null }));
  const link = join(root, 'studio.mjs');
  await symlink(fileURLToPath(new URL('./studio.mjs', import.meta.url)), link);
  const fetchStub = 'data:text/javascript,' + encodeURIComponent('globalThis.fetch = async () => ({ ok: true, json: async () => ({ offers: [] }) });');
  const child = spawn(process.execPath, ['--preserve-symlinks-main', '--import', fetchStub, link, 'export', content], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ['pipe', 'ignore', 'pipe'],
  });
  t.after(() => child.kill('SIGKILL'));
  let stderr = ''; child.stderr.on('data', (data) => { stderr += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  const [code, signal] = await once(child, 'exit'); clearTimeout(timer);
  assert.equal(signal, null, stderr); assert.equal(code, 1, stderr);
  assert.match(stderr, /physical setup file read/);
});

test('local site ownership refuses foreign directories, copied receipts and redirected state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'typedpress-dev-ownership-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  await mkdir(project);
  await mkdir(join(project, '.tp/dev'), { recursive: true });
  await writeFile(join(project, '.tp/dev/important'), 'foreign data');
  await assert.rejects(ownedState(project, true), /Unowned development directory/);
  assert.equal(await readFile(join(project, '.tp/dev/important'), 'utf8'), 'foreign data');
  await rm(join(project, '.tp/dev'), { recursive: true });
  const managed = await ownedState(project, true);
  assert.equal((await ownedState(project, false)).owner.site, join(project, '.tp/dev/wordpress'));
  const other = join(root, 'other');
  await mkdir(join(other, '.tp/dev'), { recursive: true });
  await writeFile(join(other, '.tp/dev/owner.json'), await readFile(managed.marker));
  await assert.rejects(ownedState(other, true), /ownership does not match/);
  await rm(join(other, '.tp/dev'), { recursive: true });
  await symlink(managed.state, join(other, '.tp/dev'), 'junction');
  await assert.rejects(ownedState(other, true), /symbolic link/);
  const exited = spawn(process.execPath, ['-e', '']);
  await once(exited, 'exit');
  await writeFile(join(managed.state, 'session.json'), JSON.stringify({ pid: exited.pid }));
  const contenders = await Promise.allSettled([lock(managed.state), lock(managed.state)]);
  assert.equal(contenders.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(JSON.parse(await readFile(join(managed.state, 'session.json'), 'utf8')).pid, process.pid);
  await assert.rejects(lock(managed.state), /Another typedpress dev command/);
  await contenders.find((attempt) => attempt.status === 'fulfilled').value();
});

test('publishing replaces managed plugins while retaining extra plugins and refusing collisions before writes', async (t) => {
  const project = await mkdtemp(join(tmpdir(), 'typedpress-dev-plugins-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const managed = await ownedState(project, true);
  const plugins = join(managed.owner.site, 'wp-content/plugins');
  await mkdir(join(plugins, 'extra'), { recursive: true });
  await writeFile(join(plugins, 'extra/extra.php'), 'user-installed');
  const content = join(project, 'artifact');
  const source = join(content, 'plugins/typedpress-app-test');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'typedpress-app-test.php'), 'typedpress build');
  await writeFile(join(source, 'stale.php'), 'old');
  const manifest = { app: 'test', plugins: { 'typedpress-app-test': '0.3' }, dependencies: [], locales: null };
  await writeFile(join(content, 'typedpress-manifest.json'), JSON.stringify(manifest));
  await publishPlugins(content, managed);
  await rm(join(source, 'stale.php'));
  await writeFile(join(source, 'typedpress-app-test.php'), 'second build');
  await publishPlugins(content, managed);
  assert.equal(await readFile(join(plugins, 'typedpress-app-test/typedpress-app-test.php'), 'utf8'), 'second build');
  await assert.rejects(readFile(join(plugins, 'typedpress-app-test/stale.php')), { code: 'ENOENT' });
  assert.equal(await readFile(join(plugins, 'extra/extra.php'), 'utf8'), 'user-installed');
  await writeFile(join(source, 'typedpress-app-test.php'), 'must not be published');
  await writeFile(join(content, 'typedpress-manifest.json'), JSON.stringify({ ...manifest, plugins: { ...manifest.plugins, extra: '1' } }));
  await assert.rejects(publishPlugins(content, managed), /not managed by TypedPress/);
  assert.equal(await readFile(join(plugins, 'typedpress-app-test/typedpress-app-test.php'), 'utf8'), 'second build');
});

test('watch inputs include imported TypeScript, public files and Markdown pages without reacting to generated output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'typedpress-dev-watch-'));
  const project = join(root, 'project');
  let watcher;
  let observing = Promise.resolve();
  t.after(async () => {
    watcher?.close();
    await observing;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(project);
  await mkdir(join(project, 'tp/lib'), { recursive: true });
  await mkdir(join(project, 'public'));
  await writeFile(join(project, 'typedpress.config.ts'), 'config');
  await writeFile(join(project, 'tp/lib/fields.ts'), 'tp');
  const plugins = join(project, '.tp/dev/wordpress/wp-content/plugins');
  const generated = join(plugins, 'typedpress-app-watch');
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
  await writeFile(join(project, 'tp/lib/fields.ts'), 'second');
  const second = await sourceDigest(project);
  assert.notEqual(second, first);
  await waitForDigest(second);
  await mkdir(join(project, 'tp/_generated'), { recursive: true });
  await writeFile(join(project, 'tp/_generated/db.d.ts'), 'generated');
  for (let build = 0; build < 16; build++) {
    const staged = join(plugins, `.typedpress-app-watch-${build}`);
    const previous = `${staged}.previous`;
    await mkdir(join(staged, 'blocks/deep/assets'), { recursive: true });
    await writeFile(join(staged, 'blocks/deep/assets/generated.ts'), `build ${build}`);
    await rename(generated, previous);
    await rename(staged, generated);
    await rm(previous, { recursive: true });
  }
  for (const ignored of ['.git', 'node_modules', 'tp/node_modules', 'tp/dist', 'tp/_generated/client', 'public/typedpress-styles', 'public/typedpress-assets']) {
    const directory = join(project, ignored, 'nested/generated');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'output.ts'), 'generated');
    await rm(join(project, ignored), { recursive: true });
  }
  assert.equal(await sourceDigest(project), second);
  await writeFile(join(project, 'tp/lib/fields.ts'), 'after generated plugin replacement');
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
  await mkdir(join(project, 'tp/app'), { recursive: true });
  await writeFile(join(project, 'tp/app/site.css'), 'body { margin: 0 }');
  const stylesheet = await sourceDigest(project);
  assert.notEqual(stylesheet, nestedChange);
  await waitForDigest(stylesheet);
  await writeFile(join(project, 'tp/app/site.css'), 'body { margin: 1px }');
  const restyled = await sourceDigest(project);
  assert.notEqual(restyled, stylesheet);
  await waitForDigest(restyled);
  await writeFile(join(project, 'tp/app/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const image = await sourceDigest(project);
  assert.notEqual(image, restyled);
  await waitForDigest(image);
  // A Markdown page is a build input; Markdown elsewhere (a README, notes) is not.
  await mkdir(join(project, 'tp/app/about'), { recursive: true });
  await writeFile(join(project, 'tp/app/about/page.md'), '# About');
  const markdownPage = await sourceDigest(project);
  assert.notEqual(markdownPage, image);
  await waitForDigest(markdownPage);
  await writeFile(join(project, 'tp/app/about/page.md'), '# About us');
  const markdownEdit = await sourceDigest(project);
  assert.notEqual(markdownEdit, markdownPage);
  await waitForDigest(markdownEdit);
  // The project's styles are a build input too.
  await writeFile(join(project, 'tp/theme.json'), '{"version":3}');
  const styles = await sourceDigest(project);
  assert.notEqual(styles, markdownEdit);
  await waitForDigest(styles);
  await writeFile(join(project, 'README.md'), 'notes');
  await writeFile(join(project, 'tp/app/about/notes.md'), 'notes');
  assert.equal(await sourceDigest(project), styles);
  await writeFile(join(project, 'package.json'), '{"devDependencies":{"@typedpress/frontend":"0.1.0"}}');
  const frontend = await sourceDigest(project);
  await waitForDigest(frontend);
  await writeFile(join(project, 'tp/app/about/notes.md'), '<aside class="text-lg">Notes</aside>');
  const tailwind = await sourceDigest(project);
  assert.notEqual(tailwind, frontend);
  await waitForDigest(tailwind);
});

test('--url and --host name one address for WordPress and one for TypedPress to listen on, and refuse what names none', () => {
  // Neither: Studio's own http://localhost:<port>, and nothing but its loopback listener.
  assert.deepEqual(siteAddress(['--no-watch'], 8791), { url: null, listen: null });
  // --host: TypedPress listens there on the site's port, and that is the address WordPress writes.
  assert.deepEqual(siteAddress(['--host=10.0.0.24'], 8791), { url: 'http://10.0.0.24:8791', listen: '10.0.0.24' });
  assert.deepEqual(siteAddress(['--host=dev-box.lan'], 8791), { url: 'http://dev-box.lan:8791', listen: 'dev-box.lan' });
  assert.deepEqual(siteAddress(['--host=fd7a:115c::57'], 8791), { url: 'http://[fd7a:115c::57]:8791', listen: 'fd7a:115c::57' });
  // --url: a proxy in front serves another scheme, host or port; TypedPress listens nowhere new.
  assert.deepEqual(siteAddress(['--no-watch', '--url=https://box.example.ts.net:8443/'], 8791), { url: 'https://box.example.ts.net:8443', listen: null });
  assert.deepEqual(siteAddress(['--url=https://box.example.ts.net'], 8791), { url: 'https://box.example.ts.net', listen: null });
  // Both: listen on one address, announce another.
  assert.deepEqual(siteAddress(['--host=10.0.0.24', '--url=http://dev-box.lan:8791'], 8791), { url: 'http://dev-box.lan:8791', listen: '10.0.0.24' });
  assert.deepEqual(siteAddress(['--url=http://[fd7a:115c::57]:8443'], 8791), { url: 'http://[fd7a:115c::57]:8443', listen: null });
  for (const url of ['box.example.ts.net', 'ftp://box.example', 'https://box.example/blog', 'https://box.example/?a=1', 'https://user:secret@box.example', '']) {
    assert.throws(() => siteAddress([`--url=${url}`], 8791), /--url takes an address such as https:\/\/box\.example\.ts\.net:8443/, url);
  }
  // A host that is no DNS name: the URL parser keeps quotes and decodes %27, so these are refused here.
  for (const url of ["http://a'.print(1).'.test", 'http://a%27b.test', 'http://a\\b.test', 'http://a$b.test', 'http://0.0.0.0:8443', 'http://[::]:8443']) {
    assert.throws(() => siteAddress([`--url=${url}`], 8791), /--url takes an address/, url);
  }
  // WordPress writes one address into every page: "all interfaces" names none, however it is spelled.
  for (const host of ['fe80::1%eth0', '0.0.0.0', '::', '0:0:0:0:0:0:0:0', '::ffff:0.0.0.0', '::ffff:0:0', '0::0', '0', '2130706433', '*', '', 'a/b', 'http://10.0.0.24', '10.0.0.24:8791', 'a b', "a'b"]) {
    assert.throws(() => siteAddress([`--host=${host}`], 8791), /--host takes one address or name of this machine/, host);
  }
  // The listener lives in the typedpress dev process, and --no-watch leaves none.
  assert.throws(() => siteAddress(['--no-watch', '--host=10.0.0.24'], 8791), /--host needs typedpress dev to keep running/);
});

test('--host is bound as the address it resolves to, never every interface', { timeout: 10000 }, async () => {
  assert.equal(await listenAddress('127.0.0.1'), '127.0.0.1');
  assert.match(await listenAddress('localhost'), /^(127\.0\.0\.1|::1)$/);
  // Checked again after resolving, for whatever spelling siteAddress let through, by the relay itself.
  await assert.rejects(listenAddress('0.0.0.0'), /every interface/);
  for (const host of ['0.0.0.0', '::']) {
    const bound = await forward(host, 0, 1).then((relay) => relay.close().then(() => true), () => false);
    assert.equal(bound, false, `the relay listened on ${host}`);
  }
});

test('the address file is PHP that only holds the address', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tp-address-'));
  try {
    for (const url of ['https://box.example.ts.net:8443', "http://it's.example", 'http://a\\\\b']) {
      const file = join(dir, 'address.php');
      writeFileSync(file, `${addressPhp(url)}\necho $GLOBALS['wp_filter']['pre_option_home'][10][0]['function']();\n`);
      const out = execFileSync('php', [file], { encoding: 'utf8' });
      assert.equal(out, url, 'the PHP prints the address itself, so nothing in it ran');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// wp-config.php patched as typedpress dev patches it, with this machine's `php` in place of Studio's.
function patch(source) {
  const dir = mkdtempSync(join(tmpdir(), 'tp-config-'));
  try {
    const file = join(dir, 'wp-config.php');
    writeFileSync(file, source);
    const php = (code) => execFileSync('php', ['-d', 'short_open_tag=0', '-r', code], { encoding: 'utf8' });
    return settingsOffset(async (code) => php(code), file).then((offset) => withAddressLine(source, offset));
  } finally {
    setTimeout(() => rmSync(dir, { recursive: true, force: true }), 2000);
  }
}

const ADDRESS = "if ( is_file( ABSPATH . 'tp-dev-address.php' ) ) { require ABSPATH . 'tp-dev-address.php'; } // typedpress dev --url / --host";

test('PHP prints an offset, or the start is refused', async () => {
  // Anything but a number from PHP (a notice, a warning) is refused, never read as an offset.
  await assert.rejects(settingsOffset(async () => 'Notice: something 12\n3', '/x'), /Could not read wp-config\.php/);
  assert.equal(await settingsOffset(async () => '42\n', '/x'), 42);
  // The path reaches PHP as one escaped string: a quote in it doesn't end the string.
  let seen = '';
  await settingsOffset(async (code) => { seen = code; return '-1'; }, "/tmp/it's/wp-config.php");
  assert.ok(seen.startsWith("$tp_config = '/tmp/it\\'s/wp-config.php';"), seen);
});

test('the address reaches WordPress before it loads, from one line in wp-config.php', async () => {
  const php = addressPhp('https://box.example.ts.net:8443');
  assert.equal(php.split("'https://box.example.ts.net:8443'").length, 2);
  for (const option of ['pre_option_home', 'pre_option_siteurl']) assert.ok(php.includes(`'${option}'`), option);
  // Hooks set before wp-settings.php loads plugin.php, and through add_filter where WP-CLI loaded it first.
  assert.match(php, /function_exists\( 'add_filter' \)/);
  assert.match(php, /\$GLOBALS\['wp_filter'\]/);
  const config = "<?php\ndefine( 'WP_DEBUG', false );\n/* That's all, stop editing! Happy publishing. */\n\nif ( ! defined( 'ABSPATH' ) ) {\n\tdefine( 'ABSPATH', __DIR__ . '/' );\n}\n\n/** Sets up WordPress vars and included files. */\nrequire_once ABSPATH . 'wp-settings.php';\n";
  const patched = await patch(config);
  const lines = patched.split('\n');
  const at = lines.findIndex((line) => line.includes('tp-dev-address.php'));
  assert.match(lines[at], /^if \( is_file\( ABSPATH \. 'tp-dev-address\.php' \) \) \{ require ABSPATH \. 'tp-dev-address\.php'; \}/);
  assert.equal(lines[at + 1], "require_once ABSPATH . 'wp-settings.php';");
  assert.equal(patched.replace(`${lines[at]}\n`, ''), config);
  assert.equal(withAddressLine(patched, -1), patched);
  await assert.rejects(patch("<?php\ndefine( 'WP_DEBUG', false );\n"), /wp-config\.php does not load wp-settings\.php/);
  // A require that is the body of an if or else, or part of an expression: a line put before it
  // would change what runs, so nothing is written.
  for (const body of ["if ( $a )\n\trequire_once ABSPATH . 'wp-settings.php';\nelse\n\texit;\n", "if ( $a ) { exit; } else\nrequire_once ABSPATH . 'wp-settings.php';\n", "$x = 1 +\nrequire_once ABSPATH . 'wp-settings.php';\n", "function f() {\nrequire_once ABSPATH . 'wp-settings.php';\n}\n"]) {
    await assert.rejects(patch(`<?php\n${body}`), /in a statement of its own/, body);
  }
  // The require PHP runs, not a copy of it in a comment, a string, a heredoc, an attribute or text
  // outside PHP, as PHP's tokenizer reads them (short_open_tag off, as on Studio).
  const settings = "require_once ABSPATH . 'wp-settings.php';";
  const decoys = [
    `/* old:\n${settings}\n*/`,
    `$help = <<<TXT\nx;\n${settings}\nTXT;`,
    `$help = <<<'TXT'\nx;\n${settings}\nTXT;`,
    `$help = <<<TXT\nTXTé;\nx;\n${settings}\nTXT;`,
    `?>\n<p>x;\n${settings}</p>\n<?php`,
    `?>\n<? x;\n${settings} ?>\n<?php`,
    `?>\n<?php_example x;\n${settings}\n<?php`,
    `$help = 'x;\n${settings.replaceAll("'", "\\'")}\n';`,
    `$help = "x;\n${settings}\n";`,
    `#[Example("x;\n${settings}\n")]\nfunction example() {}`,
    `// ${settings}`,
    `# ${settings}`,
  ];
  for (const decoy of decoys) {
    const source = `<?php\ndefine( 'A', 1 );\n${decoy}\nif ( ! defined( 'ABSPATH' ) ) {\n\tdefine( 'ABSPATH', __DIR__ . '/' );\n}\n${settings}\n`;
    const lines = (await patch(source)).split('\n');
    const at = lines.findIndex((line) => line.startsWith('if ( is_file( ABSPATH'));
    assert.equal(lines[at + 1], settings, decoy);
    assert.equal(lines[at - 1], '}', decoy);
    assert.equal(lines.filter((line) => line.startsWith('if ( is_file( ABSPATH')).length, 1, decoy);
  }
  // Braces in strings are no tokens of their own, so they open and close nothing. The bootstrap at
  // the end is the one patched.
  for (const lead of ['$help = "$x}";\nfunction f() {\n$a = 1;\n}', '$help = "$x{";', '$help = "${x}";\n$y = "{$z}";']) {
    const source = `<?php\n${lead}\n${settings}\n`;
    const lines = (await patch(source)).split('\n');
    assert.equal(lines.at(-3), ADDRESS, lead);
    assert.equal(lines.at(-2), settings, lead);
  }
  // Alternative control syntax can leave a block open at the end of a file: refused, not guessed.
  await assert.rejects(patch(`<?php\nif (false):\n$a = 1;\n${settings}\nendif;\n${settings}\n`), /in a statement of its own/);
  // A second require of wp-settings.php, here dormant in a function, and a last require that may
  // never run, after an earlier bootstrap and an early stop: refused.
  await assert.rejects(patch(`<?php\n$help = "$x}";\nfunction f() {\n${settings}\n}\n${settings}\n`), /in a statement of its own/);
  for (const stop of ['return;', 'exit;', 'die();', 'goto done;\ndone:']) {
    await assert.rejects(patch(`<?php\n${settings}\n${stop}\n${settings}\n`), /in a statement of its own/, stop);
  }
  await assert.rejects(patch(`<?php\nif ( $a ) { return; }\n${settings}\n`), /in a statement of its own/);
  // Code after the require: it isn't the last statement, so refused.
  await assert.rejects(patch(`<?php\n${settings}\ndefine( 'LATE', 1 );\n`), /in a statement of its own/);
  // The require must start its line: another statement before it on the line is refused.
  await assert.rejects(patch(`<?php\n$a = 1; ${settings}\n`), /in a statement of its own/);
  // A closing tag and blank text after it are fine.
  assert.match(await patch(`<?php\n${settings}\n?>\n\n`), /tp-dev-address\.php/);
  // Only in a decoy: nothing runs it, so nothing is changed.
  await assert.rejects(patch(`<?php\n/*\n${settings}\n*/\n`), /in a statement of its own/);
  const commented = await patch("<?php\ndefine( 'A', 1 ); // one\n/** Sets up WordPress vars and included files. */\nrequire_once( ABSPATH . 'wp-settings.php' );\n");
  assert.match(commented, /tp-dev-address\.php/);
});

test('--host passes connections to the loopback listener untouched and lets go of them when it closes', { timeout: 20000 }, async (t) => {
  const body = '<a href="http://localhost:8791/">kept as WordPress wrote it</a>';
  const upstream = createServer((request, response) => response.end(`${request.headers.host} ${body}`));
  await new Promise((done) => upstream.listen(0, 'localhost', done));
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const relay = await forward('127.0.0.1', 0, upstream.address().port);
  const response = await fetch(`http://127.0.0.1:${relay.port}/`);
  assert.equal(await response.text(), `127.0.0.1:${relay.port} ${body}`);
  // A browser's idle connection (this one is kept alive) does not keep typedpress dev from stopping.
  await relay.close();
  await assert.rejects(fetch(`http://127.0.0.1:${relay.port}/`));
  // An address that is not this machine's is refused with the address in the message.
  await assert.rejects(forward('192.0.2.1', 0, upstream.address().port), /Cannot listen on 192\.0\.2\.1:0/);
});

test('Vite is put where the browser that opens the site can reach it, or not used', async () => {
  const vite = { host: 'localhost', listen: false, port: 5199, ping: '/__tp_vite/@typedpress/ping', token: 'tok' };
  const local = 'http://localhost:8787';
  const asked = [];
  const answers = (body, ok = true) => async (url) => { asked.push(url); return { ok, text: async () => body }; };
  const unreachable = async (url) => { asked.push(url); throw new Error('ECONNREFUSED'); };
  // Opened on this machine: Vite's own address, and nothing is asked of the site.
  assert.equal(await viteAddress({ ...vite, site: local, local, fetcher: unreachable }), 'http://localhost:5199');
  assert.deepEqual(asked, []);
  // A proxy that passes /__tp_vite/ on: the site's own address, http or https.
  for (const site of ['https://box.example.ts.net:8443', 'http://box.example.ts.net:8080']) {
    assert.equal(await viteAddress({ ...vite, site, local, fetcher: answers('tok\n') }), '');
    assert.equal(asked.at(-1), `${site}/__tp_vite/@typedpress/ping`);
  }
  // A proxy that passes only WordPress on answers the ping with a page, a 404, or not at all:
  // an https page may not load Vite over http, and another machine cannot reach localhost.
  for (const fetcher of [answers('<html>WordPress</html>'), answers('tok', false), answers('other session'), unreachable]) {
    assert.equal(await viteAddress({ ...vite, site: 'https://box.example.ts.net:8443', local, fetcher }), null);
    assert.equal(await viteAddress({ ...vite, site: 'http://box.example.ts.net:8080', local, fetcher }), null);
  }
  // --url naming this machine by another loopback port (a local proxy): Vite's own address works.
  assert.equal(await viteAddress({ ...vite, site: 'http://localhost:9000', local, fetcher: unreachable }), 'http://localhost:5199');
  // --host: Vite listens on that address too, so an http page reaches it there, IPv6 in brackets.
  assert.equal(await viteAddress({ ...vite, host: '10.0.0.24', listen: true, site: 'http://10.0.0.24:8787', local, fetcher: unreachable }), 'http://10.0.0.24:5199');
  assert.equal(await viteAddress({ ...vite, host: 'fd00::24', listen: true, site: 'http://[fd00::24]:8787', local, fetcher: unreachable }), 'http://[fd00::24]:5199');
  // --host with an https --url that passes nothing on: mixed content, so not used.
  assert.equal(await viteAddress({ ...vite, host: '10.0.0.24', listen: true, site: 'https://box.example.ts.net', local, fetcher: unreachable }), null);
});

test('each built launcher of a served entry is replaced, and a stylesheet entry is left as built', () => {
  const entries = {
    main: { source: 'browser/index.ts', scripts: ['/typedpress-assets/entrypoints/main-abc.js'], links: ['/typedpress-assets/assets/main-abc.css'] },
    style: { source: 'browser/site.css', scripts: [], links: ['/typedpress-assets/assets/style-def.css'] },
  };
  assert.deepEqual(launcherMap(entries, { main: '/__tp_vite/@typedpress/main.js' }), {
    '/typedpress-assets/entrypoints/main-abc.js': '/__tp_vite/@typedpress/main.js',
  });
  // The filter only touches the app's own script modules on this site, and resolves a path against the site.
  assert.match(FRONTEND_PLUGIN, /str_starts_with\(\$id, 'typedpress-app-script-'\)/);
  assert.match(FRONTEND_PLUGIN, /str_starts_with\(\$vite, '\/'\) \? home_url\(\$vite\) : \$vite/);
  const lint = execFileSync('php', ['-l'], { input: FRONTEND_PLUGIN, encoding: 'utf8' });
  assert.match(lint, /No syntax errors/);
});

test('a rebuild copies only the plugins whose files changed', async (t) => {
  const project = await mkdtemp(join(tmpdir(), 'typedpress-dev-prints-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const managed = await ownedState(project, true);
  const plugins = join(managed.owner.site, 'wp-content/plugins');
  await mkdir(plugins, { recursive: true });
  const content = join(project, 'artifact');
  const manifest = {
    app: 'test', plugins: { 'typedpress-app-test': '0.3', 'typedpress-runtime': '0.3', 'action-scheduler': '4.2.0' },
    dependencies: [{ slug: 'action-scheduler', treeSha256: 'tree-1' }], locales: null,
  };
  for (const slug of Object.keys(manifest.plugins)) {
    await mkdir(join(content, 'plugins', slug), { recursive: true });
    await writeFile(join(content, 'plugins', slug, `${slug}.php`), 'first');
  }
  await writeFile(join(content, 'plugins/typedpress-app-test.zip'), 'app zip 1');
  await writeFile(join(content, 'plugins/typedpress-runtime.zip'), 'runtime zip 1');
  await writeFile(join(content, 'typedpress-manifest.json'), JSON.stringify(manifest));
  // The print is the build's ZIP, a dependency's pinned tree hash, else the version.
  const first = await pluginPrints(content, manifest);
  assert.equal(first['action-scheduler'], 'tree-1');
  assert.match(first['typedpress-app-test'], /^[0-9a-f]{64}$/);
  await publishPlugins(content, managed);

  // A page edit: the app plugin's files and ZIP change, nothing else does.
  for (const slug of Object.keys(manifest.plugins)) await writeFile(join(content, 'plugins', slug, `${slug}.php`), 'second');
  await writeFile(join(content, 'plugins/typedpress-app-test.zip'), 'app zip 2');
  const second = await pluginPrints(content, manifest);
  assert.deepEqual(Object.keys(second).filter((slug) => second[slug] !== first[slug]), ['typedpress-app-test']);
  await publishPlugins(content, managed, (slug) => second[slug] !== first[slug]);
  const published = (slug) => readFile(join(plugins, slug, `${slug}.php`), 'utf8');
  assert.equal(await published('typedpress-app-test'), 'second');
  assert.equal(await published('typedpress-runtime'), 'first');
  assert.equal(await published('action-scheduler'), 'first');
  // A plugin the site lost is copied again even when its print did not change.
  await rm(join(plugins, 'typedpress-runtime'), { recursive: true });
  await publishPlugins(content, managed, () => false);
  assert.equal(await published('typedpress-runtime'), 'second');
});

test('the reload signal names a session and its builds, carries the build error, and is cleared on stop', async () => {
  const published = [];
  const live = await liveUpdates({ publish: async (state) => { published.push(state); } });
  const { session } = published[0];
  assert.match(session, /^[0-9a-f-]{36}$/);
  assert.deepEqual(published[0], { session, revision: 0, diagnostics: [] });
  await live.updated(true);
  assert.deepEqual(published.at(-1), { session, revision: 1, diagnostics: [] });
  // A failed build keeps the revision: the page stays, with the error over it.
  const diagnostics = [{ code: 'F1001', message: 'Unexpected token', location: { file: 'tp/app/page.tsx', line: 1, column: 44 } }];
  await live.failed(Object.assign(new Error('build failed'), { diagnostics }));
  assert.deepEqual(published.at(-1), { session, revision: 1, diagnostics });
  // An error that is no compiler diagnostic (a refused migration) is shown by its message.
  await live.failed(new Error('Schema change refused'));
  assert.deepEqual(published.at(-1), { session, revision: 1, diagnostics: [{ message: 'Schema change refused' }] });
  // A build that changed nothing clears the error without a reload.
  await live.updated(false);
  assert.deepEqual(published.at(-1), { session, revision: 1, diagnostics: [] });
  await live.close();
  assert.equal(published.at(-1), null);
  // Another start is another session, so pages left open from this one reload.
  let other;
  await liveUpdates({ publish: async (state) => { other ??= state; } });
  assert.notEqual(other.session, session);
});

test('--detach reports a failed first build on standard error and exits 1', () => {
  const summary = '\nWebsite:   http://localhost:8787/';
  const log = '/work/app/.tp/dev/dev.log';
  assert.deepEqual(detachedReport({ summary, failed: null }, 41822, log), {
    out: `${summary}\nRunning in the background (pid 41822), rebuilding on save.\nLog:  ${log}`, error: '', code: 0,
  });
  const failed = detachedReport({ summary, failed: 'Failed (1): build\nerror[F1001]: Unexpected token\n' }, 41822, log);
  assert.equal(failed.code, 1);
  // The site's address and the log are still printed: the process is running.
  assert.equal(failed.out, `${summary}\nRunning in the background (pid 41822), rebuilding on save.\nLog:  ${log}`);
  assert.match(failed.error, /^typedpress dev: the first build failed, so the site does not serve this source yet:\nFailed \(1\): build\nerror\[F1001\]: Unexpected token\nWordPress is running in the background \(pid 41822\)\./);
  assert.match(failed.error, /typedpress dev status --json reports the error/);
});

test('the dev plugin adds the reload client only while dev watches, and never to a page rendered to be kept', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'typedpress-dev-plugin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'typedpress-dev'));
  await writeFile(join(root, 'typedpress-dev-runtime.php'), DEV_PLUGIN);
  await writeFile(join(root, 'page.html'), '<html><body><h1>Public file</h1></body></html>');
  // WordPress as far as the plugin uses it: hooks are recorded, and the public file's answer is replayed.
  await writeFile(join(root, 'run.php'), `<?php
namespace TypedPress\\Wp {
    final class Plugin {
        public string $dir = '/app';
        public object $schema;
        public function __construct() { $this->schema = new class { public function reserved(): array { return []; } }; }
        public static function instance(): self { return new self(); }
    }
    final class PublicFiles {
        public static function fallbackFile(Plugin $plugin): ?string { return getenv('TP_TEST_FILE') ?: null; }
    }
}
namespace {
    $GLOBALS['hooks'] = [];
    function add_action(string $hook, callable $callback): void { $GLOBALS['hooks'][$hook] = $callback; }
    function add_filter(string $hook, mixed $callback): void { $GLOBALS['hooks'][$hook] = $callback; }
    function plugins_url(string $path, string $file): string { return 'https://box.example.ts.net:8443/wp-content/mu-plugins/' . $path; }
    function add_query_arg(string $key, string $value, string $url): string { return $url . '?' . $key . '=' . $value; }
    function esc_url(string $url): string { return $url; }
    function doing_filter(string $hook): bool { return $hook === 'do_parse_request'; }
    function wp_enqueue_script(string $handle, string $src): void { $GLOBALS['enqueued'] = $src; }
    foreach (['PRERENDER', 'EXPORT'] as $name) {
        if (getenv('TP_TEST_' . $name) !== false) $_SERVER['HTTP_X_TYPEDPRESS_' . $name] = getenv('TP_TEST_' . $name);
    }
    $_SERVER['REQUEST_METHOD'] = getenv('TP_TEST_METHOD') ?: 'GET';
    require __DIR__ . '/typedpress-dev-runtime.php';
    $names = array_keys($GLOBALS['hooks']);
    sort($names);
    if (isset($GLOBALS['hooks']['wp_enqueue_scripts'])) ($GLOBALS['hooks']['wp_enqueue_scripts'])();
    fwrite(STDERR, json_encode(['hooks' => $names, 'enqueued' => $GLOBALS['enqueued'] ?? null, 'http' => TP_IDENTITY_DEV_HTTP]));
    if (isset($GLOBALS['hooks']['status_header'])) {
        // PublicFiles::emit: every buffer dropped, the status, then the file.
        while (ob_get_level() > 0) ob_end_clean();
        ($GLOBALS['hooks']['status_header'])('HTTP/1.1 ' . getenv('TP_TEST_STATUS') . ' OK', (int) getenv('TP_TEST_STATUS'));
        readfile(__DIR__ . '/page.html');
    }
}
`);
  const run = (env = {}) => {
    const child = spawnSync('php', [join(root, 'run.php')], { encoding: 'utf8', env: { ...process.env, TP_TEST_STATUS: '200', ...env } });
    assert.equal(child.status, 0, child.stderr + child.stdout);
    return { ...JSON.parse(child.stderr), body: child.stdout };
  };
  const quiet = { hooks: [], enqueued: null, http: true, body: '' };
  // Not watching: no live.json, or the one a stop or --no-watch leaves.
  assert.deepEqual(run(), quiet);
  await writeFile(join(root, 'typedpress-dev/live.json'), 'null\n');
  assert.deepEqual(run(), quiet);
  // Watching.
  await writeFile(join(root, 'typedpress-dev/live.json'), JSON.stringify({ session: 'abc', revision: 7, diagnostics: [] }));
  const client = 'https://box.example.ts.net:8443/wp-content/mu-plugins/typedpress-dev/live-client.js?build=abc.7';
  const watching = run();
  assert.deepEqual(watching.hooks, ['admin_enqueue_scripts', 'login_enqueue_scripts', 'status_header', 'tp_admin_init', 'tp_prebuilt_serve', 'wp_enqueue_scripts']);
  // The client comes from the site's own address, whatever --url made it.
  assert.equal(watching.enqueued, client);
  // A 200 that is no file from public/ passes through untouched.
  assert.equal(watching.body, '<html><body><h1>Public file</h1></body></html>');
  // A prerender or an export request renders the page as a build stores it.
  assert.deepEqual(run({ TP_TEST_PRERENDER: '1790000000.' + 'a'.repeat(64) }), quiet);
  assert.deepEqual(run({ TP_TEST_EXPORT: '1' }), quiet);
  // The answer to a form submission (wp-login.php after a failed login): a reload would send it
  // again, so neither the enqueue hooks nor the public/ HTML filter are added.
  assert.deepEqual(run({ TP_TEST_METHOD: 'POST' }), { ...quiet, hooks: ['tp_prebuilt_serve'] });
  // public/index.html: the answer carries the client; the file is read, never written.
  const page = join(root, 'page.html');
  assert.equal(run({ TP_TEST_FILE: page }).body, `<html><body><h1>Public file</h1><script src="${client}" defer></script></body></html>`);
  assert.equal(await readFile(page, 'utf8'), '<html><body><h1>Public file</h1></body></html>');
  // Not a 304, and not a file that is no HTML document.
  assert.equal(run({ TP_TEST_FILE: page, TP_TEST_STATUS: '304' }).body, '<html><body><h1>Public file</h1></body></html>');
  assert.equal(run({ TP_TEST_FILE: join(root, 'data.json') }).body, '<html><body><h1>Public file</h1></body></html>');
});

test('a reload the page cancels leaves the reload client polling', async () => {
  const source = await readFile(new URL('./live-client.js', import.meta.url), 'utf8');
  const timers = [];
  let fetches = 0, reloads = 0;
  const storage = new Map();
  const window = {};
  window.top = window; window.self = window;
  runInNewContext(source, {
    window, URL,
    document: {
      hidden: false, currentScript: { src: 'http://localhost:8881/wp-content/mu-plugins/typedpress-dev/live-client.js?build=abc.1' },
      addEventListener() {},
    },
    location: { origin: 'http://localhost:8881', reload() { reloads += 1; } },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async () => { fetches += 1; return { ok: true, json: async () => ({ session: 'abc', revision: 2, diagnostics: [] }) }; },
    setTimeout: (callback) => { timers.push(callback); },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  // Build 2 is live: the page reloads, and the editor's unsaved-changes prompt is answered Stay.
  assert.equal(reloads, 1);
  assert.equal(timers.length, 1);
  // The next check still runs, and does not reload again for the same build.
  timers.shift()();
  await settle();
  assert.equal(fetches, 2);
  assert.equal(reloads, 1);
  assert.equal(timers.length, 1);
});
