import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { parseHTML, DOMParser } from 'linkedom';
import { cleanup, makeProject, root, start, wp, command } from './local.mjs';

const evidence = await mkdtemp(join(tmpdir(), 'typedpress-official-full-app-'));
console.log(`Official source acceptance evidence: ${evidence}`);
const save = (name, data) => writeFile(join(evidence, name), typeof data === 'string' ? data : JSON.stringify(data,null,2));
const modes = process.env.OFFICIAL_TEMPLATE ? [process.env.OFFICIAL_TEMPLATE] : ['blank','starter','blog'];
if (modes.some(mode => !['blank','starter','blog'].includes(mode))) throw new Error('OFFICIAL_TEMPLATE must be blank, starter or blog.');
execFileSync(process.execPath, [join(root,'build.mjs'), ...modes], { stdio: 'inherit', timeout: 180000 });

// This owns only the new seam: original Astro source ↔ migrated native TypedPress data.
// Existing native collection/SCF/compiler suites own their internal behavior.
test('pinned official Astro blank, starter and blog run against compiled native TypedPress backends', { timeout: 1200000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const summary = [];
  for (const mode of modes) await t.test(mode, { timeout: 600000 }, async t => {
    const project = await makeProject(mode);
    t.after(async () => {
      await save(`${mode}-frontend.log`, await readFile(join(project, 'frontend.log'),'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error)));
      const proof = await cleanup(project);
      await assert.rejects(access(project), { code: 'ENOENT' });
      await save(`${mode}-cleanup.json`,proof);
    });
    const receipt = await start(project,mode);
    await save(`${mode}-receipt.json`,receipt);
    const { backend, frontend } = receipt;
    const password = await wp(project,'user','application-password','create','admin','official-frontend-acceptance','--porcelain');
    const authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
    async function rest(path, { method = 'GET', body, auth = true } = {}) {
      const response = await fetch(path.startsWith('__tp/') ? `${backend}/${path}` : `${backend}/wp-json/${path}`, { method, headers: { ...(auth ? { authorization } : {}), ...(body === undefined ? {} : { 'content-type':'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const json = await response.json();
      assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(json)}`);
      return json.data ?? json;
    }
    async function html(path, status = 200) {
      const response = await fetch(`${frontend}${path}`, { signal: AbortSignal.timeout(30000) });
      const body = await response.text();
      assert.equal(response.status,status,`${path}: ${body.slice(0,500)}`);
      return body;
    }
    if (mode === 'blank') {
      const home = await html('/');
      const { document } = parseHTML(home);
      assert.equal(document.querySelector('h1').textContent, 'Welcome to EmDash');
      assert.equal(document.querySelector('main a').getAttribute('href'), '/_emdash/admin');
      const schema = await rest('__tp/api/v1', { auth: false });
      assert.equal(schema.runtime.wp.database.kind, 'sqlite');
      const redirect = await fetch(`${frontend}/_emdash/admin`, { redirect: 'manual' });
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers.get('location'), `${backend}/wp-admin/`);
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      t.after(() => context.close());
      const page = await context.newPage();
      await page.goto(frontend);
      await expect(page.getByRole('heading', { name: 'Welcome to EmDash' })).toBeVisible();
      await page.screenshot({ path: join(evidence, 'blank-desktop.png'), fullPage: true });
      await page.getByRole('link', { name: 'admin panel' }).click();
      await expect(page.locator('#user_login')).toBeVisible();
      await page.locator('#user_login').fill('admin');
      await page.locator('#user_pass').fill('typedpress-test-admin');
      await page.locator('#wp-submit').click();
      await page.waitForURL(/\/wp-admin\//);
      await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
      await page.screenshot({ path: join(evidence, 'blank-native-admin.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(frontend);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: join(evidence, 'blank-mobile.png'), fullPage: true });
      await save('blank-home.html', home);
      summary.push({ mode, originalFrontend: true, compiledBackend: true, nativeAdminNavigation: true, mobileOverflow: false });
      await save('results.json', summary);
      return;
    }
    const seed = JSON.parse(await readFile(join(root,mode,'seed/seed.json'),'utf8'));
    const first = receipt.entries.find(entry => entry.collection === 'posts');
    assert.ok(first);
    const pagePath = mode === 'starter' ? '/about' : '/pages/about';
    for (const path of ['/', '/posts', `/posts/${first.slug}`, pagePath]) await html(path);
    for (const tax of seed.taxonomies) for (const term of tax.terms) await html(`/${tax.name}/${term.slug}`);
    await html('/posts/not-a-real-official-post',404);
    await html('/category/not-a-real-category',404);
    const home = await html('/');
    const { document } = parseHTML(home);
    assert.ok(document.title.includes(seed.settings.title));
    assert.ok(document.querySelector(`a[href="/posts/${first.slug}"]`));
    await save(`${mode}-upstream-home.html`,home);
    for (const media of receipt.media) {
      const nativeBytes = Buffer.from(await (await fetch(media.url)).arrayBuffer());
      assert.equal(createHash('sha256').update(nativeBytes).digest('hex'), media.sha256, `${media.url}: the served image is the downloaded original`);
    }

    // A native WordPress/SCF edit must flow through both adapters into unchanged source.
    const title = `Official ${mode} observatory`;
    console.log(`${mode}: official seed routes and native media passed`);
    const bodyText = 'Native WordPress blocks now power the official Astro frontend.';
    await rest(`wp/v2/tp_posts/${first.id}`, { method:'POST', body: { title,
      content: `<!-- wp:heading --><h2 class="wp-block-heading">Saved native heading</h2><!-- /wp:heading --><!-- wp:paragraph --><p>${bodyText}</p><!-- /wp:paragraph -->`,
      acf: { tp_excerpt: 'Saved through native SCF.', tp_seoTitle: 'Official source SEO title', tp_seoDescription: 'Saved native metadata.' } } });
    const edited = await html(`/posts/${first.slug}`);
    assert.ok(edited.includes(bodyText));
    assert.ok((await html('/posts')).includes('Saved through native SCF.'));
    assert.ok(edited.includes('Official source SEO title'));
    assert.ok((await html('/posts')).includes(title));
    // The blog has a search results page upstream; the starter has only the live search.
    if (mode === 'blog') assert.ok((await html(`/search?q=${encodeURIComponent(title)}`)).includes(title));
    const liveResponse = await fetch(`${frontend}/api/search?q=${encodeURIComponent(title)}`);
    const live = await liveResponse.json();
    assert.deepEqual(live.items.map(item => item.path),[`/posts/${first.slug}`]);
    await save(`${mode}-native-edit.html`,edited);

    console.log(`${mode}: native edit and live search passed`);
    const draft = await rest('wp/v2/tp_posts', { method:'POST', body: { title:'Unpublished migration draft',slug:`${mode}-private-source`,status:'draft',content:'Private original source draft.' } });
    await html(`/posts/${mode}-private-source`,404);
    assert.equal((await html('/posts')).includes('Unpublished migration draft'),false);
    // TypedPress's signed preview link of the draft's staged version opens on the Astro site.
    await rest(`__tp/api/v1/posts/${draft.id}/staged`, { method:'PATCH', body: { body: '<!-- wp:paragraph --><p>Private original source draft.</p><!-- /wp:paragraph -->' } });
    const link = await rest(`__tp/api/v1/posts/${draft.id}/staged/preview`, { method:'POST', body: {} });
    const previewUrl = new URL(`/posts/${mode}-private-source?preview=${encodeURIComponent(link.token)}`, frontend);
    const draftHtml = await html(previewUrl.pathname + previewUrl.search);
    assert.ok(draftHtml.includes('Private original source draft.'));
    await html(`${previewUrl.pathname}?preview=forged`,404);
    await rest(`wp/v2/tp_posts/${draft.id}`,{method:'POST',body:{status:'publish',password:'disposable-test-reader',acf:{tp_excerpt:'Protected content marker'}}});
    await html(`/posts/${mode}-private-source`,404);
    assert.equal((await html('/posts')).includes('Protected content marker'),false);

    console.log(`${mode}: signed draft preview and privacy passed`);
    const reading = await rest('__tp/api/v1/actions/readingTime',{method:'POST',auth:false,body:{content:'word '.repeat(201) + '漢'.repeat(501)}});
    assert.deepEqual(reading,{minutes:3});

    if (mode === 'blog') {
      const feedResponse = await fetch(`${frontend}/rss.xml`);
      assert.match(feedResponse.headers.get('content-type'),/application\/rss\+xml/);
      const feed = await feedResponse.text();
      const parsed = new DOMParser().parseFromString(feed,'text/xml');
      assert.ok([...parsed.querySelectorAll('item title')].some(item => item.textContent === title));
      assert.equal(feed.includes('Unpublished migration draft'),false);
      await save('blog-rss.xml',feed);
      for (let i = 0; i < 15; i++) await rest('__tp/api/v1/posts', { method:'POST', body: { title:`Native pagination boundary ${i}`, slug:`boundary-${i}`, status:'published', publishedAt:'2001-01-01T00:00:00.000Z' } });
      const { document: archive } = parseHTML(await html('/posts'));
      const next = archive.querySelector('nav[aria-label="Pagination"] a[href*="cursor="]');
      assert.ok(next,'The official Pagination component exposes a next cursor.');
      const pageTwo = await html(next.getAttribute('href'));
      assert.ok(pageTwo.includes('Native pagination boundary'));
      assert.equal(pageTwo.includes(title),false);
      // What a browser sends for the template's own form; Astro refuses form posts it can't tell are same-origin.
      const crossSite = await fetch(`${frontend}/wp-comments-post.php`, {method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded','sec-fetch-site':'cross-site',origin:'https://elsewhere.example'},body:'comment=x'});
      assert.equal(crossSite.status,403,'a cross-site comment form post is refused');
      const submitted = await fetch(`${frontend}/wp-comments-post.php`, {method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded','sec-fetch-site':'same-origin',origin:frontend,referer:`${frontend}/posts/${first.slug}`},body:new URLSearchParams({comment_post_ID:String(first.id),comment_parent:'0',author:'Official source reader',email:'reader@example.test',comment:'A moderated comment on the original Astro frontend.',redirect_to:`${frontend}/posts/${first.slug}#comments`})});
      assert.equal(submitted.status,302,await submitted.text());
      assert.equal((await html(`/posts/${first.slug}`)).includes('A moderated comment on the original Astro frontend.'),false);
      const pending = await rest(`wp/v2/comments?post=${first.id}&status=hold`);
      assert.equal(pending.length,1);
      await rest(`wp/v2/comments/${pending[0].id}`,{method:'POST',body:{status:'approved'}});
      const reply = await rest('wp/v2/comments',{method:'POST',body:{post:first.id,parent:pending[0].id,author_name:'Native editor',author_email:'editor@example.test',content:'A native threaded response.',status:'approved'}});
      const { document: conversation } = parseHTML(await html(`/posts/${first.slug}`));
      assert.ok(conversation.querySelector(`#comment-${pending[0].id} #comment-${reply.id}`));
    }

    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors=[];
    page.on('pageerror',error => errors.push(error.message));
    await page.goto(`${frontend}/posts/${first.slug}`);
    await expect(page.locator('h1')).toHaveText(title);
    await expect(page.getByRole('heading',{name:'Saved native heading'})).toBeVisible();
    if (mode === 'blog') {
      const image = page.locator('article img').first();
      await expect(image).toBeVisible();
      await expect(image).toHaveJSProperty('complete',true);
      assert.equal(await image.evaluate(element => element.complete && element.naturalWidth > 0),true);
      await page.getByRole('button',{name:'Dark',exact:true}).click();
      await page.reload();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(page.locator('.toc a')).toContainText(['Saved native heading']);
      await expect(page.getByText('A native threaded response.', { exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toBeVisible();
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({path:join(evidence,`${mode}-desktop.png`),fullPage:true});
    await page.goto(`${frontend}/`);
    const liveInput=page.locator('typedpress-live-search input').first();
    await liveInput.fill(title);
    const liveLink=page.locator('typedpress-live-search [data-results] a').filter({hasText:title}).first();
    await expect(liveLink).toBeVisible();
    await liveLink.click();
    await expect(page.locator('h1')).toHaveText(title);
    await page.setViewportSize({width:390,height:844});
    await page.goto(frontend);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,`${mode}: mobile overflow`);
    await page.screenshot({path:join(evidence,`${mode}-mobile.png`),fullPage:true});
    await page.goto(`${backend}/wp-login.php`);
    await page.locator('#user_login').fill('admin');
    await page.locator('#user_pass').fill('typedpress-test-admin');
    await page.locator('#wp-submit').click();
    await page.waitForURL(/\/wp-admin\//);
    await page.goto(`${backend}/wp-admin/edit.php?post_type=tp_posts`);
    const row=page.locator(`#post-${first.id}`);
    await row.hover();
    await row.locator('button.editinline').click();
    const editor=page.locator(`#edit-${first.id}`);
    await editor.locator('input[name=post_title]').fill(`Browser saved ${mode} source`);
    await editor.locator('button.save').click();
    await expect(page.locator(`#post-${first.id} .row-title`)).toHaveText(`Browser saved ${mode} source`);
    if (mode === 'blog') {
      // The widget areas are the app's `widgets` global (an SCF JSON field in wp-admin); an edit
      // to it through the API reaches the template's footer.
      const { areas } = await rest('__tp/api/v1/widgets');
      const footer = areas.find(area => area.name === 'footer');
      footer.widgets[0].content = [{ _type:'block', _key:'native-widget', style:'normal', children:[{ _type:'span', text:'A widgets edit reaches the official footer.' }] }];
      await rest('__tp/api/v1/widgets', { method:'PATCH', body: { areas } });
    }
    await page.goto(`${frontend}/posts/${first.slug}`);
    await expect(page.locator('h1')).toHaveText(`Browser saved ${mode} source`);
    if (mode === 'blog') {
      await expect(page.locator('footer')).toContainText('A widgets edit reaches the official footer.');
    }
    assert.deepEqual(errors,[]);
    const plugins=JSON.parse(await wp(project,'plugin','list','--status=active','--format=json'));
    assert.equal(plugins.some(plugin => plugin.name === 'secure-custom-fields'),true);
    summary.push({mode,originalFrontend:true,nativeEditing:true,upstreamRoutes:true,media:receipt.media.length,draftPreview:true,compiledReadingTime:true,liveSearch:true,mobileOverflow:false,pageErrors:errors});
    await save('results.json',summary);
  });
});
