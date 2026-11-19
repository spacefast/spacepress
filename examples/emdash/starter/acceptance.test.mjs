import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, command, makeProject, repository, start, wp } from './local.mjs';

const evidence = await mkdtemp(join(tmpdir(), 'typedpress-emdash-publishing-evidence-'));
const results = [];
console.log(`Evidence: ${evidence}`);

async function save(name, value) {
  await writeFile(join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

// One owner for the three related examples. Each subtest proves its own seam:
// blank's native WordPress, starter's native/SCF editing, blog's delivery surfaces.
test('official publishing counterparts run on native Studio with owned cleanup', { timeout: 1200000 }, async (t) => {
  for (const mode of ['blank', 'starter', 'blog']) await t.test(mode, { timeout: 600000 }, async (t) => {
    const project = await makeProject(mode);
    t.after(async () => {
      const proof = await cleanup(project);
      await assert.rejects(access(project), { code: 'ENOENT' });
      await save(`${mode}-cleanup.json`, proof);
      console.log(`${mode}: stopped exact owned site; deleted its Studio registration and project.`);
    });
    const receipt = await start(project, mode);
    await save(`${mode}-receipt.json`, receipt);
    await cp(join(project, '.tp/dev/owner.json'), join(evidence, `${mode}-owner.json`));
    const { base } = receipt;
    const password = await wp(project, 'user', 'application-password', 'create', 'admin', 'publication-acceptance', '--porcelain');
    const authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
    async function json(path, { method = 'GET', body, auth = true, expected } = {}) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...(auth ? { authorization } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (expected !== undefined) assert.equal(response.status, expected, JSON.stringify(result));
      else assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
      return result.data ?? result;
    }
    async function html(path, status = 200) {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, status, path);
      return response.text();
    }
    const schema = await json('/wp-json/typedpress/v1');
    assert.equal(schema.runtime.wp.database.kind, 'sqlite');
    const front = await html('/');
    await save(`${mode}-home.html`, front);
    assert.match(front, /WordPress admin/);
    const login = await html('/wp-login.php');
    assert.match(login, /user_login/);
    const nativeSettings = await json('/wp-json/wp/v2/settings');
    assert.equal(typeof nativeSettings.title, 'string');
    const plugins = JSON.parse(await wp(project, 'plugin', 'list', '--status=active', '--format=json'));
    assert.equal(plugins.some((plugin) => plugin.name === 'typedpress-admin'), false);
    assert.equal(plugins.some((plugin) => plugin.name === 'secure-custom-fields'), true);

    if (mode === 'blank') {
      assert.match(front, /Welcome to TypedPress/);
      const page = await json('/wp-json/wp/v2/pages', { method: 'POST', body: {
        title: 'A native blank page', slug: 'native-blank-page', status: 'publish',
        content: '<!-- wp:paragraph --><p>Blank native editor proof.</p><!-- /wp:paragraph -->',
      } });
      assert.equal(page.status, 'publish');
      assert.match(await html('/native-blank-page'), /Blank native editor proof\./);
      await json(`/wp-json/wp/v2/pages/${page.id}`, { method: 'POST', body: { password: 'disposable-reader-password' } });
      const locked = await html('/native-blank-page');
      assert.doesNotMatch(locked, /Blank native editor proof\./);
      assert.match(locked, /post-password-form/);
      const unlocked = await fetch(`${base}/wp-login.php?action=postpass`, {
        method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ post_password: 'disposable-reader-password' }), signal: AbortSignal.timeout(30000),
      });
      const cookie = unlocked.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
      assert.notEqual(cookie, '');
      assert.match(await (await fetch(`${base}/native-blank-page`, { headers: { cookie } })).text(), /Blank native editor proof\./);
      results.push({ mode, nativePages: true, fullWordPress: true });
      return;
    }

    const post = await json('/wp-json/wp/v2/tp_posts', { method: 'POST', body: {
      title: `${mode} native first draft`, slug: `${mode}-acceptance`, status: 'publish',
      content: '<!-- wp:paragraph --><p>Original blocks.</p><!-- /wp:paragraph -->',
      acf: { tp_excerpt: 'Original SCF excerpt.' },
    } });
    const marker = `${mode} observatory ${Date.now()}`;
    await json(`/wp-json/wp/v2/tp_posts/${post.id}`, { method: 'POST', body: {
      title: marker,
      content: '<!-- wp:paragraph --><p>Native REST blocks reach the public theme.</p><!-- /wp:paragraph -->',
      acf: { tp_excerpt: 'SCF changes appear on archive cards.', tp_seoTitle: 'A saved SEO title', tp_seoDescription: 'A saved description.' },
    } });
    const records = await json('/wp-json/typedpress/v1/posts');
    const record = records.find((row) => row.id === post.id);
    assert.equal(record.title, marker);
    assert.equal(record.excerpt, 'SCF changes appear on archive cards.');
    const single = await html(`/posts/${mode}-acceptance`);
    assert.match(single, /Native REST blocks reach the public theme\./);
    assert.match(single, /A saved SEO title/);
    assert.match(single, /content="A saved description\."/);
    assert.ok((await html('/posts')).includes(marker));
    assert.match(await html('/posts'), /SCF changes appear on archive cards\./);
    await save(`${mode}-native-save.html`, single);
    const draft = await json('/wp-json/wp/v2/tp_posts', { method: 'POST', body: {
      title: 'Private editorial draft', slug: `${mode}-private`, status: 'draft', content: 'Unpublished draft body.',
    } });
    const anonymous = await json('/wp-json/typedpress/v1/posts', { auth: false });
    assert.equal(anonymous.some((row) => row.id === draft.id), false);
    assert.equal((await html('/posts')).includes('Private editorial draft'), false);
    await html(`/posts/${mode}-private`, 404);
    await json(`/wp-json/wp/v2/tp_posts/${draft.id}`, { method: 'POST', body: {
      status: 'publish', password: 'disposable-reader-password', acf: { tp_excerpt: 'Protected excerpt marker', tp_seoDescription: 'Protected metadata marker' },
    } });
    const protectedPage = await html(`/posts/${mode}-private`);
    assert.match(protectedPage, /post-password-form/);
    assert.doesNotMatch(protectedPage, /Unpublished draft body\.|Protected excerpt marker|Protected metadata marker|wp-comments-post\.php/);
    assert.doesNotMatch(await html('/posts'), /Private editorial draft|Protected excerpt marker/);
    await json('/wp-json/wp/v2/tp_posts', { method: 'POST', auth: false, expected: 401, body: { title: 'Anonymous write', status: 'publish' } });
    const pagePath = mode === 'blog' ? '/pages/about' : '/about';
    const pages = await json('/wp-json/wp/v2/tp_pages?slug=about');
    assert.equal(pages.length, 1);
    await json(`/wp-json/wp/v2/tp_pages/${pages[0].id}`, { method: 'POST', body: {
      content: '<!-- wp:paragraph --><p>About was saved in native WordPress.</p><!-- /wp:paragraph -->',
    } });
    assert.match(await html(pagePath), /About was saved in native WordPress\./);
    const revisions = await json(`/wp-json/wp/v2/tp_posts/${post.id}/revisions`);
    assert.ok(revisions.length >= 1, 'Native editing retains a revision.');
    const search = await html(`/search?q=${encodeURIComponent(marker)}`);
    assert.ok(search.includes(`/posts/${mode}-acceptance`), 'Saved title is searchable through WordPress.');
    await save(`${mode}-search.html`, search);

    if (mode === 'blog') {
      const category = await json('/wp-json/wp/v2/categories', { method: 'POST', body: { name: 'Observations', slug: 'observations' } });
      const tag = await json('/wp-json/wp/v2/tags', { method: 'POST', body: { name: 'Native saves', slug: 'native-saves' } });
      await json(`/wp-json/wp/v2/tp_posts/${post.id}`, { method: 'POST', body: { categories: [category.id], tags: [tag.id] } });
      for (const path of ['/category/observations', '/tag/native-saves']) {
        const archive = await html(path);
        assert.ok(archive.includes(marker), `Saved taxonomy drives ${path}`);
      }
      const bytes = Buffer.from(await wp(project, 'eval', '$i=imagecreatetruecolor(16,10); ob_start(); imagepng($i); echo base64_encode(ob_get_clean());'), 'base64');
      const uploaded = await fetch(`${base}/wp-json/wp/v2/media`, { method: 'POST', headers: {
        authorization, 'content-type': 'image/png', 'content-disposition': 'attachment; filename="publication-proof.png"',
      }, body: bytes, signal: AbortSignal.timeout(30000) });
      const media = await uploaded.json();
      assert.equal(uploaded.status, 201, JSON.stringify(media));
      await json(`/wp-json/wp/v2/tp_posts/${post.id}`, { method: 'POST', body: { acf: { tp_cover: media.id } } });
      assert.ok((await html(`/posts/${mode}-acceptance`)).includes('publication-proof.png'));
      assert.deepEqual(Buffer.from(await (await fetch(media.source_url)).arrayBuffer()), bytes);
      await wp(project, 'eval', 'for($i=0;$i<14;$i++){wp_insert_post(["post_type"=>"tp_posts","post_status"=>"publish","post_title"=>"Archive boundary ".$i,"post_name"=>"archive-boundary-".$i,"post_date"=>"2001-01-01 00:00:00"]);}');
      const first = await html('/posts');
      const next = first.match(/rel="next" href="([^"]+)"/);
      assert.ok(next, 'More than twenty stored posts produces a next page.');
      const nextUrl = new URL(next[1].replaceAll('&#038;', '&').replaceAll('&amp;', '&'), base);
      const second = await html(nextUrl.pathname + nextUrl.search);
      assert.match(second, /Archive boundary/);
      const secondCards = [...second.matchAll(/<article class="card">([\s\S]*?)<\/article>/g)].map((match) => match[1]).join('');
      assert.equal(secondCards.includes(marker), false, 'Page two advances beyond the latest post; the sidebar stays recent.');
      await save('blog-page-two.html', second);
      const feedResponse = await fetch(`${base}/rss.xml`);
      assert.match(feedResponse.headers.get('content-type'), /application\/rss\+xml/);
      const feed = await feedResponse.text();
      assert.ok(feed.includes(marker), 'RSS includes the native saved title.');
      assert.equal(feed.includes('Private editorial draft'), false);
      await save('blog-rss.xml', feed);
      await json(`/wp-json/wp/v2/tp_posts/${post.id}`, { method: 'POST', body: { comment_status: 'open' } });
      const commentText = 'A real reader submitted this observation.';
      const submitted = await fetch(`${base}/wp-comments-post.php`, {
        method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ comment_post_ID: String(post.id), comment_parent: '0', author: 'A reader', email: 'reader@example.test', comment: commentText }),
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(submitted.status, 302, await submitted.text());
      assert.equal((await html(`/posts/${mode}-acceptance`)).includes(commentText), false, 'Submitted comments await moderation.');
      const pending = await json(`/wp-json/wp/v2/comments?post=${post.id}&status=hold`);
      assert.equal(pending.length, 1);
      await json(`/wp-json/wp/v2/comments/${pending[0].id}`, { method: 'POST', body: { status: 'approved' } });
      const conversation = await html(`/posts/${mode}-acceptance`);
      assert.ok(conversation.includes(commentText), 'Native REST approval publishes the real form submission.');
      assert.match(conversation, /wp-comments-post\.php/);
      await wp(project, 'theme', 'mod', 'set', 'tp_footer', 'Saved appearance from native WordPress.');
      assert.match(await html('/'), /Saved appearance from native WordPress\./);
      await wp(project, 'option', 'update', 'blogname', 'Renamed native publication');
      assert.match(await html('/'), /Renamed native publication/);
      await save('blog-final.html', conversation);
      // Restarting native dev preserves editor data and unrelated plugins.
      const unrelated = join(receipt.site, 'wp-content/plugins/publication-unrelated');
      await mkdir(unrelated);
      await writeFile(join(unrelated, 'publication-unrelated.php'), '<?php /* Plugin Name: Publication unrelated */');
      await wp(project, 'plugin', 'activate', 'publication-unrelated');
      await command(['dev', 'stop', project]);
      await command(['dev', project, '--no-watch']);
      assert.ok((await html(`/posts/${mode}-acceptance`)).includes(marker));
      assert.equal(await wp(project, 'plugin', 'is-active', 'publication-unrelated'), '');
      const persisted = await json('/wp-json/wp/v2/settings');
      assert.equal(persisted.title, 'Renamed native publication');
      results.push({ mode, nativeScfEdit: true, draftAccess: true, taxonomy: true, media: true, pagination: true, rss: true, approvedComments: true, appearance: true, restartPersistence: true });
    } else results.push({ mode, nativeScfEdit: true, nativePages: true, draftAccess: true, search: true, revisions: true });
    await save('results.json', results);
  });
  await save('results.json', results);
});
