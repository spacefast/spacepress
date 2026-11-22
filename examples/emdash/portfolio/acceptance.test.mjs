import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { seedPortfolio } from './seed.mjs';
import { startStudio } from './studio.mjs';

// This is the cross-surface owner: a real native Studio WordPress, not a substitute API.
test('official portfolio runs on native Studio: uploads, native editing, public routes, filtering and RSS', { timeout: 900000 }, async (t) => {
  const studio = await startStudio();
  const { api, request, wp, base, evidence, site } = studio;
  console.log(`Portfolio Studio evidence: ${evidence}`);
  t.after(async () => {
    if (process.env.TP_PORTFOLIO_KEEP === '1') console.log(`Retained exact disposable project: ${studio.project}\nSite: ${base}\nCleanup: ${evidence}/studio.json`);
    else await studio.cleanup();
  });
  const schema = await api('');
  assert.equal(schema.runtime.wp.database.kind, 'sqlite');
  assert.deepEqual(schema.runtime.pendingMigrations, []);
  const pluginsBefore = JSON.parse(await wp('plugin', 'list', '--status=active', '--format=json'));
  assert.equal(pluginsBefore.some((p) => p.name === 'secure-custom-fields'), true);
  await mkdir(join(site, 'wp-content/plugins/portfolio-unrelated'));
  await writeFile(join(site, 'wp-content/plugins/portfolio-unrelated/plugin.php'), '<?php /* Plugin Name: Portfolio unrelated persistence check */');
  await wp('plugin', 'activate', 'portfolio-unrelated');
  const nativeImage = Buffer.from(await wp('eval', '$i=imagecreatetruecolor(320,240); $c=imagecolorallocate($i,78,100,75); imagefill($i,0,0,$c); imagestring($i,5,30,100,"NATIVE PORTFOLIO",imagecolorallocate($i,240,238,220)); ob_start(); imagepng($i); echo base64_encode(ob_get_clean());'), 'base64');
  const uploaded = await studio.uploadBytes({ bytes: nativeImage, filename: 'portfolio-native.png', alt: 'A native portfolio acceptance image' });
  await writeFile(join(evidence, 'uploaded.png'), nativeImage);
  await writeFile(join(evidence, 'media.json'), JSON.stringify({ id: uploaded.id, url: uploaded.source_url, bytes: nativeImage.length, sha256: createHash('sha256').update(nativeImage).digest('hex') }, null, 2));
  // The complete sample content is persisted in WP. Only the acceptance image is generated;
  // dev.mjs imports the original remote photographs into the same native media library.
  const seeded = await seedPortfolio({ api, upload: async () => uploaded });
  await writeFile(join(evidence, 'seeded.json'), JSON.stringify(seeded, null, 2));
  const get = async (path, status = 200) => {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30000) });
    const text = await response.text();
    assert.equal(response.status, status, `${path}: ${text.slice(0, 500)}`);
    return { response, text };
  };
  const page = async (path, filename, status = 200) => {
    const result = await get(path, status);
    await writeFile(join(evidence, filename), result.text);
    return result;
  };
  const home = await page('/', 'home.html');
  assert.equal((home.text.match(/<h1\b/g) ?? []).length, 1);
  assert.equal((home.text.match(/data-project=/g) ?? []).length, seeded.projects.filter((p) => p.featured).length);
  assert.match(home.text, /North Bakehouse/);
  assert.match(home.text, /https:\/\/github.com\/norma/);
  assert.match(home.text, /https:\/\/www.instagram.com\/norma.studio/);
  const work = await page('/work', 'work.html');
  assert.equal((work.text.match(/data-project=/g) ?? []).length, 6);
  const filtered = await page('/work?tag=digital', 'filtered.html');
  assert.match(filtered.text, /Ola Ceramics/);
  assert.doesNotMatch(filtered.text, /data-project="north-bakehouse"/);
  assert.match(filtered.text, /tag=digital" aria-current="page"/);
  await get('/work?tag=unknown-discipline', 404);
  await get('/work?offset=broken', 404);
  await get('/work?cursor=broken', 404);
  const homeRedirect = await fetch(`${base}/home?from=acceptance`, { redirect: 'manual' });
  assert.equal(homeRedirect.status, 301);
  assert.equal(homeRedirect.headers.get('location'), `${base}/?from=acceptance`);
  for (const p of seeded.projects) {
    const detail = await page(`/work/${p.slug}`, `case-${p.slug}.html`);
    assert.match(detail.text, new RegExp(p.title));
    assert.match(detail.text, /class="gallery"/);
    assert.match(detail.text, /A native portfolio acceptance image/);
    assert.match(detail.text, /property="og:image"/);
    const headings = detail.text.match(/<h1\b/g) ?? [];
    assert.equal(headings.length, 1);
  }
  const oldest = await get('/work/north-bakehouse');
  assert.doesNotMatch(oldest.text, /class="next-project"/);
  const newest = await get('/work/hotel-wilde');
  assert.match(newest.text, /rel="next"[^>]+concrete-futures/);
  const about = await page('/about', 'about.html');
  assert.match(about.text, /Norma is an independent design studio in Rotterdam/);
  const contact = await page('/contact', 'contact.html');
  assert.equal((contact.text.match(/<h1\b/g) ?? []).length, 1);
  assert.match(contact.text, /mailto:hello@norma.example/);
  assert.match(contact.text, /Visits by appointment/);
  const feed = await page('/rss.xml', 'feed.xml');
  assert.match(feed.response.headers.get('content-type'), /^application\/rss\+xml/);
  assert.equal((feed.text.match(/<item>/g) ?? []).length, 6);
  const parsed = await wp('eval', '$x=simplexml_load_file(home_url("/rss.xml")); if (!$x) throw new Exception("Invalid RSS"); echo count($x->channel->item);');
  assert.equal(parsed, '6');
  const hotel = seeded.projects.find((p) => p.slug === 'hotel-wilde');
  assert.notEqual(hotel, undefined);
  const replacementBytes = Buffer.from(await wp('eval', '$i=imagecreatetruecolor(12,8); imagefill($i,0,0,imagecolorallocate($i,200,120,40)); ob_start(); imagepng($i); echo base64_encode(ob_get_clean());'), 'base64');
  const replacement = await studio.uploadBytes({ bytes: replacementBytes, filename: 'portfolio-native-replacement.png', alt: 'Replacement selected through native SCF' });
  // Native core REST + SCF update, not a TypedPress API write: stored values and public effects must agree.
  await request(`/wp-json/wp/v2/tp_projects/${hotel.id}`, { method: 'POST', body: {
    title: 'Hotel Wilde & Friends',
    content: '<!-- wp:paragraph --><p>Saved through the native WordPress editor.</p><!-- /wp:paragraph -->',
    acf: { tp_cover: replacement.id, tp_client: 'Native studio client', tp_summary: 'A native edit & a public result.', tp_tags: ['digital'], tp_featured: false,
      tp_gallery: [{ image: replacement.id, caption: 'Native gallery caption' }],
      tp_seo: { title: 'Native case study', description: 'Search description from SCF', noindex: true },
    },
  } });
  const stored = await api(`/projects/${hotel.id}`);
  assert.equal(stored.cover, replacement.id);
  assert.equal(stored.title, 'Hotel Wilde & Friends');
  assert.equal(stored.client, 'Native studio client');
  assert.equal(stored.summary, 'A native edit & a public result.');
  assert.deepEqual(stored.tags, ['digital']);
  assert.equal(stored.featured, false);
  assert.equal(stored.gallery[0].caption, 'Native gallery caption');
  const changed = await page('/work/hotel-wilde', 'case-native-edit.html');
  assert.match(changed.text, /Hotel Wilde &amp; Friends/);
  assert.match(changed.text, /Native studio client/);
  assert.match(changed.text, /Saved through the native WordPress editor/);
  assert.match(changed.text, /Native gallery caption/);
  assert.match(changed.text, /portfolio-native-replacement.png/);
  assert.match(changed.text, /Replacement selected through native SCF/);
  assert.match(changed.text, /<title>Native case study — Norma<\/title>/);
  assert.match(changed.text, /name="robots" content="noindex,follow"/);
  assert.doesNotMatch((await get('/')).text, /data-project="hotel-wilde"/);
  assert.match((await get('/work?tag=digital')).text, /data-project="hotel-wilde"/);
  assert.doesNotMatch((await get('/work?tag=spatial')).text, /data-project="hotel-wilde"/);
  assert.match((await get('/work?tag=spatial')).text, /No Spatial projects yet/);
  assert.match((await get('/rss.xml')).text, /<title>Hotel Wilde &amp; Friends<\/title>/);
  const revisions = await request(`/wp-json/wp/v2/tp_projects/${hotel.id}/revisions`);
  assert.ok(revisions.length >= 1, 'Native project edits must retain WordPress revisions');
  // Native SCF flexible-content save changes the home heading, keeps a single h1, and persists in TypedPress.
  const homepage = seeded.pages.find((p) => p.slug === 'home');
  await request(`/wp-json/wp/v2/tp_pages/${homepage.id}`, { method: 'POST', body: { acf: { tp_layout: [
    { acf_fc_layout: 'statement', text: 'Edited in the native layout editor.', label: 'Studio acceptance' },
    { acf_fc_layout: 'selectedWork', heading: 'Native selected work' },
    { acf_fc_layout: 'clients', heading: 'Native clients', clients: [{ name: 'Native studio client' }] },
  ] } } });
  assert.equal((await api(`/pages/${homepage.id}`)).layout[0].text, 'Edited in the native layout editor.');
  const changedHome = await page('/', 'home-native-edit.html');
  assert.match(changedHome.text, /Edited in the native layout editor/);
  assert.match(changedHome.text, /Native selected work/);
  assert.match(changedHome.text, /Native clients/);
  assert.equal((changedHome.text.match(/<h1\b/g) ?? []).length, 1);
  // The native SCF options API updates the same globals read by TypedPress and the public shell.
  const settingsWP = JSON.parse(await wp('eval', 'echo wp_json_encode(\\TypedPress\\Wp\\Plugin::instance()->schema->globals()["settings"]["wp"]);'));
  assert.notEqual(settingsWP, undefined);
  await wp('eval', `wp_set_current_user(1); update_field(${JSON.stringify(settingsWP.fieldKeyPrefix + 'title')}, 'Native Norma', ${JSON.stringify(settingsWP.postId)});`);
  assert.equal((await api('/settings')).title, 'Native Norma');
  assert.match((await get('/')).text, /Native Norma/);
  assert.match((await get('/rss.xml')).text, /<title>Native Norma<\/title>/);
  // Drafts stay private through every public route even when the requester is otherwise an editor.
  const draft = await api('/projects', { method: 'POST', body: { title: 'Private acceptance draft', slug: 'private-acceptance-draft', status: 'draft', cover: uploaded.id, tags: ['digital'] } });
  await get('/work/private-acceptance-draft', 404);
  assert.doesNotMatch((await get('/work')).text, /Private acceptance draft/);
  assert.doesNotMatch((await get('/rss.xml')).text, /Private acceptance draft/);
  const anonymousDraft = await fetch(`${base}/wp-json/typedpress/v1/projects/${draft.id}`);
  assert.equal(anonymousDraft.status, 404);
  const session = JSON.parse(await wp('eval', 'echo wp_json_encode(["name" => LOGGED_IN_COOKIE, "value" => wp_generate_auth_cookie(1, time()+3600, "logged_in"), "authName" => AUTH_COOKIE, "authValue" => wp_generate_auth_cookie(1, time()+3600, "auth")]);'));
  const cookie = `${session.name}=${session.value}; ${session.authName}=${session.authValue}`;
  const preview = await fetch(`${base}/?p=${draft.id}&preview=true`, { headers: { cookie } });
  assert.equal(preview.status, 200);
  const previewHTML = await preview.text();
  assert.match(previewHTML, /Private acceptance draft/);
  assert.match(previewHTML, /Preview — only editors/);
  assert.match(previewHTML, /name="robots" content="noindex,follow"/);
  await writeFile(join(evidence, 'draft-preview.html'), previewHTML);
  const anonymousPreview = await get(`/?p=${draft.id}&preview=true`);
  assert.doesNotMatch(anonymousPreview.text, /Private acceptance draft/);
  for (const path of ['/wp-admin/plugins.php', '/wp-admin/options-general.php', `/wp-admin/post.php?post=${hotel.id}&action=edit`]) {
    const adminPage = await fetch(`${base}${path}`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(adminPage.status, 200, `${path} must remain available to the native editor`);
  }
  // One agent mutation proves that the registered Ability writes the same data and public page.
  const ability = await request('/wp-json/wp-abilities/v1/abilities/portfolio/projects-update/run', { method: 'POST', body: { input: { id: hotel.id, patch: { client: 'Ability studio client' } } } });
  assert.equal(ability.client, 'Ability studio client');
  assert.equal((await api(`/projects/${hotel.id}`)).client, 'Ability studio client');
  assert.match((await get('/work/hotel-wilde')).text, /Ability studio client/);
  await writeFile(join(evidence, 'ability.json'), JSON.stringify(ability, null, 2));
  // Seven additional real records cross the 12-row boundary and exercise the six-newest fallback.
  for (const p of seeded.projects) await request(`/wp-json/wp/v2/tp_projects/${p.id}`, { method: 'POST', body: { acf: { tp_featured: false } } });
  for (let i = 0; i < 7; i++) await api('/projects', { method: 'POST', body: { title: `Archive project ${i + 1}`, slug: `archive-${i + 1}`, status: 'published', publishedAt: `2026-07-${String(i + 1).padStart(2, '0')}T12:00:00Z`, cover: uploaded.id, tags: ['digital'] } });
  const fallback = await page('/', 'home-fallback.html');
  assert.equal((fallback.text.match(/data-project=/g) ?? []).length, 6);
  assert.match(fallback.text, /data-project="archive-7"/);
  assert.doesNotMatch(fallback.text, /data-project="archive-1"/);
  const first = await page('/work?tag=digital', 'pagination-first.html');
  const second = await page('/work?tag=digital&offset=12', 'pagination-second.html');
  // The digital filter now has nine projects: no extra page. The full archive has thirteen.
  assert.equal((first.text.match(/data-project=/g) ?? []).length, 9);
  assert.equal((second.text.match(/data-project=/g) ?? []).length, 0);
  const archive = await get('/work');
  assert.equal((archive.text.match(/data-project=/g) ?? []).length, 12);
  assert.match(archive.text, /rel="next"/);
  const lastPage = await get('/work?offset=12');
  assert.equal((lastPage.text.match(/data-project=/g) ?? []).length, 1);
  assert.match(lastPage.text, /north-bakehouse/);
  const plugins = JSON.parse(await wp('plugin', 'list', '--status=active', '--format=json'));
  for (const before of pluginsBefore) assert.equal(plugins.some((p) => p.name === before.name), true, `Plugin disappeared: ${before.name}`);
  assert.equal(plugins.some((p) => p.name === 'portfolio-unrelated'), true);
  const admin = await fetch(`${base}/wp-admin/plugins.php`, { redirect: 'manual' });
  assert.equal(admin.status, 302);
  assert.match(admin.headers.get('location'), /wp-login.php/);
  await writeFile(join(evidence, 'PASS.txt'), 'PASS: native Studio WordPress + SCF, actual PNG upload/byte equality, all six seeded cases, tag filtering/empty state, selected work/fallback, native title/content/SCF/layout/options edits, public metadata/RSS, drafts/revisions/authenticated preview, pagination, Ability mutation, authenticated admin/settings/plugin preservation.\n');
  console.log(`PASS: Portfolio native editing and public acceptance. Evidence: ${evidence}`);
});
