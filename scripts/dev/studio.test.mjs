import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownedState, publishPlugins, sourceDigest, watchSources, lock } from './studio.mjs';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';

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

test('watch inputs include imported TypeScript and public files without reacting to generated output', async (t) => {
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
});
