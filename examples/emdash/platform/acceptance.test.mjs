import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';

const exec = promisify(execFile);
const example = dirname(fileURLToPath(import.meta.url));
const repo = resolve(example, '../../..');
const first = resolve(process.env.FIRST_BIN ?? join(repo, 'target/debug/first'));

async function port() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const value = server.address().port;
  await new Promise((done) => server.close(done));
  return value;
}

// One application journey; pure validation/operator matrices belong to the existing runtime suites.
test('platform editorial workflow on an owned native Studio WordPress site', { timeout: 900000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'first-emdash-platform-'));
  const project = join(root, 'app');
  const evidence = process.env.PLATFORM_EVIDENCE ?? `${root}-evidence`;
  await mkdir(project); await mkdir(evidence, { recursive: true });
  for (const name of ['first.config.ts', 'content', 'public']) await cp(join(example, name), join(project, name), { recursive: true });
  const initialConfig = await readFile(join(project, 'first.config.ts'), 'utf8');
  const records = [];
  const results = [];
  const command = async (args) => {
    const result = await exec(first, args, { cwd: repo, timeout: 600000, maxBuffer: 8 * 1024 * 1024 }).catch((error) => {
      if (!args.includes('application-password')) records.push({ command: ['first', ...args], exitCode: error.code, stdout: error.stdout, stderr: error.stderr });
      throw error;
    });
    if (args[0] !== 'dev' || !args.includes('application-password')) records.push({ command: ['first', ...args], stdout: result.stdout, stderr: result.stderr });
    return result.stdout.trim();
  };
  const wp = (...args) => command(['wp', '--site', project, ...args]);
  const hit = [];
  const receiver = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    hit.push({ headers: request.headers, body: Buffer.concat(chunks).toString() });
    response.writeHead(204); response.end();
  });
  await new Promise((done) => receiver.listen(0, '127.0.0.1', done));
  const receiverUrl = `http://127.0.0.1:${receiver.address().port}/events`;
  let owned = false;
  t.after(async () => {
    const cleanup = { project, site: join(project, '.first/dev/wordpress'), stopped: false, registrationDeleted: false, filesDeleted: false };
    if (owned) {
      try {
        await command(['dev', 'stop', project]);
        cleanup.stopped = JSON.parse(await command(['dev', 'status', project])).isOnline === false;
        await exec('npx', ['--yes', '--package', 'wp-studio@2.1.1', '--', 'studio', 'delete', '--path', cleanup.site, '--no-files'], { cwd: repo, timeout: 120000 });
        cleanup.registrationDeleted = true;
      } catch (error) { cleanup.error = error.message; }
    }
    await new Promise((done) => receiver.close(done));
    if (!owned || cleanup.registrationDeleted) { await rm(root, { recursive: true, force: true }); cleanup.filesDeleted = true; }
    await writeFile(join(evidence, 'commands.json'), JSON.stringify(records, null, 2));
    await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2));
    await writeFile(join(evidence, 'cleanup.json'), JSON.stringify(cleanup, null, 2));
    console.log(`Platform evidence: ${evidence}`);
    assert.equal(cleanup.stopped, true, JSON.stringify(cleanup));
    assert.equal(cleanup.registrationDeleted, true, JSON.stringify(cleanup));
  });
  async function step(name, fn) {
    try { await fn(); results.push({ name, result: 'PASS' }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, result: 'ISSUES', message: error.message }); console.error(`ISSUES ${name}: ${error.message}`); }
  }

  owned = true;
  await command(['dev', project, '--port', String(await port()), '--no-watch']);
  const status = JSON.parse(await command(['dev', 'status', project]));
  assert.equal(status.isOnline, true);
  const base = status.siteUrl.replace(/\/$/, '');
  await writeFile(join(evidence, 'site.json'), JSON.stringify({ project, siteUrl: base, owner: JSON.parse(await readFile(join(project, '.first/dev/owner.json'), 'utf8')) }, null, 2));
  const secret = 'disposable-platform-hook-secret';
  await wp('config', 'set', 'PLATFORM_HOOK_URL', receiverUrl);
  await wp('config', 'set', 'PLATFORM_HOOK_SECRET', secret);
  const credentials = {};
  for (const [login, role] of [['platform_editor', 'editor'], ['platform_reader', 'subscriber']]) {
    await wp('user', 'create', login, `${login}@example.test`, `--role=${role}`, '--user_pass=disposable-platform-only');
    const password = await wp('user', 'application-password', 'create', login, 'platform-acceptance', '--porcelain');
    credentials[role] = `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
  }
  const adminPassword = await wp('user', 'application-password', 'create', 'admin', 'platform-acceptance', '--porcelain');
  credentials.admin = `Basic ${Buffer.from(`admin:${adminPassword}`).toString('base64')}`;
  async function http(path, { method = 'GET', body, role = 'editor', raw, headers = {}, expected } = {}) {
    const response = await fetch(base + path, {
      method, headers: { ...(role ? { authorization: credentials[role] } : {}), ...(body === undefined && raw === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(30000),
    });
    const value = await response.json();
    records.push({ method, path, role, status: response.status, result: value });
    if (expected !== undefined) assert.equal(response.status, expected, JSON.stringify(value));
    else assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
    return value.data ?? value;
  }
  const api = (path, options) => http('/__first/api/v1' + path, options);
  let story, writer, task, french, media;
  const body = '<!-- wp:paragraph --><p>A story from the native editor.</p><!-- /wp:paragraph -->';
  await step('native REST + SCF creates a draft with nested values; First reads persisted data', async () => {
    const schema = await api('');
    assert.equal(schema.runtime.wp.database.kind, 'sqlite');
    writer = await api('/writers', { method: 'POST', body: { name: 'Robin' } });
    const native = await http('/wp-json/wp/v2/first_stories', { method: 'POST', body: {
      title: 'The native editorial desk', status: 'draft', content: body,
      acf: { first_writerId: writer.id, first_price: 4, first_editorNote: 'Editors only', first_details: { subtitle: 'A real draft', featured: false },
        first_links: [{ label: 'Read more', href: 'https://example.com/read' }],
        first_sections: [{ acf_fc_layout: 'quote', text: 'Ship small.', cite: 'Robin' }],
        first_metadata: '{"enabled":false,"optional":null,"object":{},"list":[]}' },
    } });
    story = await api(`/stories/${native.id}`);
    const persisted = JSON.parse(await wp('eval', `echo wp_json_encode([get_post(${story.id})->post_status, get_field('first_details', ${story.id}), get_field('first_links', ${story.id}), get_field('first_sections', ${story.id})]);`));
    await writeFile(join(evidence, 'native-scf.json'), JSON.stringify({ native: persisted, first: story }, null, 2));
    assert.equal(persisted[0], 'draft'); assert.equal(persisted[1].featured, false);
    assert.equal(persisted[2][0].label, 'Read more'); assert.equal(persisted[3][0].acf_fc_layout, 'quote');
    assert.deepEqual([story.title, story.status, story.body, story.details, story.links, story.metadata], [
      'The native editorial desk', 'draft', body, { subtitle: 'A real draft', featured: false },
      [{ label: 'Read more', href: 'https://example.com/read' }], { enabled: false, optional: null, object: {}, list: [] },
    ]);
    assert.equal(story.sections[0].text, 'Ship small.');
    await http(`/wp-json/wp/v2/first_stories/${story.id}`, { method: 'POST', body: { acf: { first_details: { featured: null } } } });
    assert.equal((await api(`/stories/${story.id}`)).details.featured, null);
    await api(`/stories/${story.id}`, { method: 'PATCH', body: { details: { subtitle: 'A real draft', featured: false } } });
    await http(`/wp-json/wp/v2/first_stories/${story.id}`, { method: 'POST', body: { acf: { first_details: { subtitle: 'A real draft' } } } });
    assert.equal((await api(`/stories/${story.id}`)).details.featured, false, 'a native sibling edit preserves the saved toggle');
  });
  await step('role boundaries hide drafts and editor notes; publish reaches anonymous readers', async () => {
    assert.deepEqual(await api('/stories', { role: null }), []);
    await api('/stories', { method: 'POST', role: 'subscriber', body: { title: 'Forbidden' }, expected: 403 });
    await api(`/stories/${story.id}`, { method: 'PATCH', body: { status: 'published', details: { subtitle: 'Published from First', featured: false } } });
    const visible = await api(`/stories/${story.id}`, { role: null });
    assert.equal(visible.details.subtitle, 'Published from First');
    assert.equal(Object.hasOwn(visible, 'editorNote'), false);
    const publicNative = await http(`/wp-json/wp/v2/first_stories/${story.id}`, { role: null });
    assert.equal(Object.hasOwn(publicNative.acf, 'first_editorNote'), false);
    const native = await http(`/wp-json/wp/v2/first_stories/${story.id}`);
    assert.equal(native.acf.first_details.subtitle, 'Published from First');
    assert.equal(await wp('post', 'get', String(story.id), '--field=post_status'), 'publish');
    assert.equal((await api(`/stories/${story.id}`)).editorNote, 'Editors only');
  });
  await step('post-to-post and SQL-to-post relations; a real hook enqueues an Action Scheduler job', async () => {
    task = await api('/tasks', { method: 'POST', body: { label: '  Review the journal  ', storyId: story.id } });
    await wp('action-scheduler', 'run', '--hooks=first_job');
    const related = await api(`/stories/${story.id}?with=writer,tasks`);
    assert.equal(related.writer.name, 'Robin');
    assert.deepEqual(related.tasks.map((row) => [row.id, row.label, row.processed]), [[task.id, 'Review the journal', true]]);
    assert.equal((await api(`/tasks/${task.id}?with=story`)).story.title, story.title);
    const native = JSON.parse(await wp('eval', `global $wpdb; echo wp_json_encode($wpdb->get_row('SELECT label, processed, storyId FROM ' . $wpdb->prefix . 'first_tasks WHERE id=${task.id}', ARRAY_A));`));
    assert.equal(native.label, 'Review the journal'); assert.equal(Number(native.processed), 1); assert.equal(Number(native.storyId), story.id);
  });
  await step('revision restoration and Polylang translations preserve shared fields across native and First writes', async () => {
    const revisions = await api(`/stories/${story.id}/revisions`);
    const snapshot = await api(`/stories/${story.id}/revisions/${revisions[0].id}`);
    await http(`/wp-json/wp/v2/first_stories/${story.id}`, { method: 'POST', body: { title: 'Temporary headline', acf: { first_metadata: 'null' } } });
    assert.equal((await api(`/stories/${story.id}`)).metadata, null);
    await api(`/stories/${story.id}/revisions/${revisions[0].id}/restore`, { method: 'POST' });
    assert.equal((await api(`/stories/${story.id}`)).title, snapshot.title);
    french = await api('/stories', { method: 'POST', body: { title: 'Le bureau éditorial', locale: 'fr', translationOf: story.id } });
    await http(`/wp-json/wp/v2/first_stories/${french.id}`, { method: 'POST', body: { acf: { first_price: 9 } } });
    assert.equal((await api(`/stories/${story.id}`)).price, 9);
    const native = JSON.parse(await wp('eval', `echo wp_json_encode([pll_get_post_language(${french.id}), pll_get_post_translations(${story.id}), get_post_meta(${story.id}, 'first_price', true)]);`));
    assert.deepEqual(native, ['fr', { en: story.id, fr: french.id }, '9']);
    assert.equal((await api('/stories?locale=fr', { role: null }))[0].title, 'Le bureau éditorial');
  });
  await step('real disk uploads and transformed image bytes reach the public frontend', async () => {
    const image = Buffer.from(await wp('eval', '$i=imagecreatetruecolor(400,200); $red=imagecolorallocate($i,255,0,0); imagefilledrectangle($i,0,0,399,199,$red); ob_start(); imagepng($i); echo base64_encode(ob_get_clean());'), 'base64');
    const form = new FormData(); form.append('file', new Blob([image], { type: 'image/png' }), 'platform.png');
    const response = await fetch(`${base}/__first/api/v1/media`, { method: 'POST', headers: { authorization: credentials.editor }, body: form });
    const uploaded = await response.json(); assert.equal(response.status, 201, JSON.stringify(uploaded)); media = uploaded.data;
    assert.deepEqual([media.sizes.card.width, media.sizes.card.height], [120, 120]);
    const original = Buffer.from(await (await fetch(media.url)).arrayBuffer()); assert.deepEqual(original, image);
    const crop = Buffer.from(await (await fetch(media.sizes.card.url)).arrayBuffer());
    assert.deepEqual([...crop.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    assert.deepEqual([crop.readUInt32BE(16), crop.readUInt32BE(20)], [120, 120]);
    const disk = JSON.parse(await wp('eval', `$s=wp_get_attachment_image_src(${media.id}, 'first_card'); $p=dirname(get_attached_file(${media.id})).'/'.wp_basename($s[0]); echo wp_json_encode(['exists'=>is_file($p),'sha'=>hash_file('sha256',$p)]);`));
    assert.deepEqual(disk, { exists: true, sha: createHash('sha256').update(crop).digest('hex') });
    await api(`/stories/${story.id}`, { method: 'PATCH', body: { cover: media.id } });
    assert.equal((await api(`/stories/${story.id}?with=cover`, { role: null })).cover.sizes.card.url, media.sizes.card.url);
    await writeFile(join(evidence, 'original.png'), original); await writeFile(join(evidence, 'card.png'), crop);
    const publicPage = await fetch(`${base}/wp-content/plugins/first-app-platform/public/index.html`);
    assert.equal(publicPage.status, 200);
    await writeFile(join(evidence, 'public.html'), await publicPage.text());
  });
  await step('outbound signed webhook hits a real HTTP receiver; inbound HMAC persists its effect', async () => {
    assert.equal(hit.length, 1, JSON.stringify(hit));
    const delivery = hit[0]; const timestamp = /t=(\d+)/.exec(delivery.headers['first-signature'])[1];
    assert.equal(delivery.headers['first-signature'], `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${delivery.body}`).digest('hex')}`);
    assert.equal(JSON.parse(delivery.body).event, 'tasks.created');
    const raw = JSON.stringify({ message: 'Received by the real runtime' });
    await api('/actions/receive', { method: 'POST', raw, role: null, headers: { 'first-signature': 'invalid' }, expected: 401 });
    await api('/actions/receive', { method: 'POST', raw, role: null, headers: { 'first-signature': createHmac('sha256', secret).update(raw).digest('hex') } });
    assert.deepEqual((await api('/deliveries')).map((row) => row.message), ['Received by the real runtime']);
    await writeFile(join(evidence, 'webhook.json'), JSON.stringify(delivery, null, 2));
  });
  await step('CLI sync pushes a Markdown draft and pulls a native WordPress edit without a commit', async () => {
    const login = `admin:${adminPassword}`;
    const sync = async () => {
      const value = await exec(first, ['sync', project, '--site', base, '--no-commit', '--json'], { cwd: repo, timeout: 180000, env: { ...process.env, FIRST_APP_PASSWORD: login } }).catch((error) => { throw new Error(String(error.message).replaceAll(login, '[redacted]')); });
      records.push({ command: ['FIRST_APP_PASSWORD=[redacted]', 'first', 'sync', project, '--site', base, '--no-commit', '--json'], stdout: value.stdout, stderr: value.stderr });
    };
    await sync();
    const guides = await api('/guides'); const guide = guides[0];
    assert.equal(guide.status, 'draft'); assert.match(guide.body, /Small tools, real content/);
    await http(`/wp-json/wp/v2/first_guides/${guide.id}`, { method: 'POST', body: { title: 'Edited in WordPress', content: '<!-- wp:paragraph -->\n<p>Pulled from the native editor.</p>\n<!-- /wp:paragraph -->' } });
    await sync();
    const content = await readFile(join(project, 'content/guides', `${guide.slug}.md`), 'utf8');
    assert.match(content, /Edited in WordPress/); assert.match(content, /Pulled from the native editor/);
    await writeFile(join(evidence, 'synced-guide.md'), content);
  });
  await step('additive migration, rejected destructive migration and restart preserve data, plugins and identity', async () => {
    await wp('option', 'update', 'blogdescription', 'Preserve this native setting');
    const plugin = join(project, '.first/dev/wordpress/wp-content/plugins/platform-neighbor'); await mkdir(plugin);
    await writeFile(join(plugin, 'platform-neighbor.php'), '<?php /* Plugin Name: Platform neighbor */'); await wp('plugin', 'activate', 'platform-neighbor');
    const restart = async (...args) => { await command(['dev', 'stop', project]); await command(['dev', project, '--no-watch', ...args]); };
    const additive = initialConfig.replace('export const tasks = table({', 'export const tasks = table({ shelf: text(),');
    await writeFile(join(project, 'first.config.ts'), additive); await restart();
    await api(`/tasks/${task.id}`, { method: 'PATCH', body: { shelf: 'A2' } });
    await command(['dev', 'stop', project]);
    await writeFile(join(project, 'first.config.ts'), initialConfig);
    await assert.rejects(command(['dev', project, '--no-watch']), /preserv|destructive|drop/i);
    await writeFile(join(project, 'first.config.ts'), additive); await command(['dev', project, '--no-watch']);
    assert.equal((await api(`/tasks/${task.id}`)).shelf, 'A2');
    await writeFile(join(project, 'first.config.ts'), initialConfig); await restart('--allow-destructive');
    assert.equal((await api(`/tasks/${task.id}`)).label, 'Review the journal');
    assert.equal(await wp('option', 'get', 'blogdescription'), 'Preserve this native setting');
    assert.equal(JSON.parse(await command(['dev', 'status', project])).siteUrl, status.siteUrl);
    assert.equal((await api(`/stories/${story.id}`)).price, 9);
    assert.equal((await api(`/stories/${french.id}?locale=fr`)).title, 'Le bureau éditorial');
    assert.equal((await fetch(media.url)).status, 200);
    const active = JSON.parse(await wp('plugin', 'list', '--status=active', '--format=json'));
    assert.equal(active.some((row) => row.name === 'platform-neighbor'), true);
    assert.equal(await wp('user', 'get', 'platform_editor', '--field=roles'), 'editor');
  });
  await step('browser renders public stories, relationships, image and locale; native settings/plugins and First admin stay available', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const publicContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await publicContext.newPage(); const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const frontend = `${base}/wp-content/plugins/first-app-platform/public/index.html`;
      await page.goto(frontend);
      await expect(page.getByRole('link', { name: 'The native editorial desk', exact: true })).toBeVisible();
      await expect(page.locator('article').getByText('Robin', { exact: true })).toBeVisible();
      await expect(page.locator('article img')).toBeVisible();
      assert.equal(await page.locator('article img').evaluate((image) => image.naturalWidth), 200);
      await page.screenshot({ path: join(evidence, 'public-list.png'), fullPage: true });
      await page.getByRole('link', { name: 'The native editorial desk', exact: true }).click();
      await expect(page.getByText('A story from the native editor.', { exact: true })).toBeVisible();
      await expect(page.getByRole('blockquote')).toHaveText('Ship small.');
      await page.screenshot({ path: join(evidence, 'public-detail.png'), fullPage: true });
      await page.getByLabel('Language').selectOption('fr');
      await expect(page.getByRole('link', { name: 'Le bureau éditorial', exact: true })).toBeVisible();
      await page.screenshot({ path: join(evidence, 'public-french.png'), fullPage: true });
      assert.deepEqual(errors, []);
      const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const admin = await adminContext.newPage();
      await admin.goto(`${base}/wp-login.php`);
      await admin.locator('#user_login').fill('admin'); await admin.locator('#user_pass').fill('first-test-admin');
      await admin.locator('#wp-submit').click();
      await admin.goto(`${base}/wp-admin/plugins.php`);
      await expect(admin.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible();
      await expect(admin.getByText('Platform neighbor', { exact: true })).toBeVisible();
      await admin.screenshot({ path: join(evidence, 'native-plugins.png'), fullPage: true });
      await admin.goto(`${base}/wp-admin/options-general.php`);
      await expect(admin.locator('#blogdescription')).toHaveValue('Preserve this native setting');
      await admin.goto(`${base}/first-admin/`);
      await expect(admin.getByRole('heading', { name: 'Collections', exact: true })).toBeVisible();
      await expect(admin.getByRole('link', { name: 'Stories', exact: true }).last()).toBeVisible();
      await admin.screenshot({ path: join(evidence, 'first-admin.png'), fullPage: true });
    } finally { await browser.close(); }
  });
  assert.deepEqual(results.filter((row) => row.result !== 'PASS'), [], 'Every application journey must pass');
});
