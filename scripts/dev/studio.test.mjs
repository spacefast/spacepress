import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownedState, publishPlugins, sourceDigest, watchSources, lock } from './studio.mjs';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';

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
  for (const ignored of ['.git', 'node_modules', 'tp/node_modules', 'tp/dist', 'tp/_generated/client']) {
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
});
