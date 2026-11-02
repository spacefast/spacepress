import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const harness = JSON.parse(
	readFileSync(
		process.env.ZERO_WP_HARNESS ??
			fileURLToPath(
				new URL('../../../../tests/wp/.harness.json', import.meta.url)
			),
		'utf8'
	)
);
const site: string = harness.url;
const subdir = new URL(site).pathname !== '/';
async function login(page: Page, role: 'admin' | 'editor' | 'subscriber') {
	await page.goto(`${site}/zero-admin/`);
	await expect(page.locator('#user_login')).toBeVisible();
	await page.locator('#user_login').fill(role);
	await page.locator('#user_pass').fill(`zero-test-${role}`);
	await page.locator('#wp-submit').click();
	await expect(page).toHaveURL(`${site}/zero-admin/`);
	await expect(
		page.getByRole('heading', { name: 'Collections', exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('link', { name: 'Posts', exact: true }).last()
	).toBeVisible();
}
test('normal WordPress login reaches the shipped admin and root navigation', async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await login(page, 'editor');
	await page.screenshot({
		path: test.info().outputPath('collections.png'),
		animations: 'disabled',
	});
	const cookies = await page.context().cookies(`${site}/zero-admin/`);
	expect(cookies.some((c) => /^wordpress_logged_in_/.test(c.name))).toBe(true);
	expect(
		cookies.filter((c) => /^wordpress_(?:sec_)?[a-f0-9]+$/.test(c.name))
	).toEqual([]);
	const sidebar = page.locator('.zero-admin-sidebar__content');
	await expect(sidebar.getByRole('link', { name: 'All collections', exact: true })).toBeVisible();
	await sidebar.getByRole('link', { name: 'Posts', exact: true }).click();
	await expect(page).toHaveURL(`${site}/zero-admin/collections/posts`);
	await expect(
		page.getByRole('heading', { name: 'Posts', exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'New Posts', exact: true })
	).toBeEnabled();

	await page.getByRole('link', { name: 'Media', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Add Media File', exact: true })
	).toBeVisible();
	const classic = sidebar.getByRole('link', { name: 'Classic admin', exact: true });
	await expect(classic).toHaveAttribute('href', `${site}/wp-admin/`);
	await classic.click();
	await expect(page).toHaveURL(`${site}/wp-admin/`);
	const wordpressMenu = page.locator('#adminmenu');
	await expect(wordpressMenu).toBeVisible();
	await expect(page.locator('#wpadminbar')).toBeVisible();
	await expect(wordpressMenu.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
	await page.screenshot({ path: test.info().outputPath('classic-admin.png'), animations: 'disabled' });
	await wordpressMenu.getByRole('link', { name: 'Zero', exact: true }).click();
	await expect(page).toHaveURL(`${site}/zero-admin/`);
	await sidebar.getByRole('link', { name: 'Posts', exact: true }).click();
	await expect(page).toHaveURL(`${site}/zero-admin/collections/posts`);
	await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible();
	await sidebar.getByRole('link', { name: 'All collections', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Collections', exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});
// The subdirectory lane proves mounting/login/navigation with the same owner. Writes are
// exercised once on the standard install, alongside the API's existing storage/access owners.
if (!subdir) {
	test('collection and table creation, native editing, save and reload persist through REST', async ({
		page,
		request,
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		const adminHeaders = {
			Authorization: `Basic ${Buffer.from(`admin:${harness.users.admin.appPassword}`).toString('base64')}`,
		};
		const authorName = `Browser author ${Date.now()}`;
		const author = await request.post(`${site}/wp-json/zero/v1/authors`, {
			headers: adminHeaders,
			data: { name: authorName, email: `browser-${Date.now()}@example.com` },
		});
		expect(author.status(), await author.text()).toBe(201);
		const authorId = (await author.json()).data.id;
		await login(page, 'editor');
		await page.getByRole('link', { name: 'Posts', exact: true }).last().click();
		await page.getByRole('button', { name: 'New Posts', exact: true }).click();
		const title = `Browser journey ${Date.now()}`;
		await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
		await page
			.getByRole('textbox', { name: 'Excerpt', exact: true })
			.fill('Created in Zero Admin');
		await page
			.getByRole('button', { name: 'Create record', exact: true })
			.click();
		await expect(page).toHaveURL(/\/collections\/posts\/\d+$/);
		const id = new URL(page.url()).pathname.split('/').pop();
		// These are user interactions in the shipped Gutenberg editor, not store dispatches.
		const editor = page.frameLocator('iframe[name="editor-canvas"]');
		await expect(
			editor.getByRole('textbox', { name: 'Add title', exact: true })
		).toBeVisible();
		await editor
			.getByRole('textbox', { name: 'Add title', exact: true })
			.fill(`${title} edited`);
		const excerpt = page.getByRole('textbox', { name: 'Excerpt', exact: true });
		const fieldsToggle = page.getByRole('button', { name: 'Fields', exact: true });
		await expect(fieldsToggle).toBeVisible();
		if ((await fieldsToggle.getAttribute('aria-expanded')) !== 'true') {
			await fieldsToggle.click();
		}
		await expect(excerpt).toBeVisible();
		await page
			.getByRole('textbox', { name: 'Excerpt', exact: true })
			.fill('Edited in native Fields');
		await page.getByRole('combobox', { name: 'Author Id', exact: true }).fill(authorName);
		await page.getByRole('option', { name: authorName, exact: true }).click();
		await page.getByRole('button', { name: 'Add Sections', exact: true }).click();
		const section = page.getByRole('group', { name: 'Sections', exact: true });
		await section.getByRole('textbox', { name: 'Heading', exact: true }).fill('Native structured fields');
		await page.getByRole('button', { name: 'Block Inserter', exact: true }).click();
		await page.getByRole('option', { name: 'Image', exact: true }).click();
		const chooser = page.waitForEvent('filechooser');
		await editor.getByRole('button', { name: 'Upload', exact: true }).click();
		const uploaded = page.waitForResponse(
			(r) => new URL(r.url()).pathname.endsWith('/wp/v2/media') &&
				r.request().method() === 'POST'
		);
		await (await chooser).setFiles({
			name: `native-browser-${Date.now()}.png`,
			mimeType: 'image/png',
			buffer: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
				'base64'
			),
		});
		const upload = await uploaded;
		expect(upload.status(), await upload.text()).toBe(201);
		const media = await upload.json();
		expect(media).toMatchObject({ type: 'attachment', media_type: 'image' });
		await expect(editor.locator('figure img')).toHaveAttribute('src', media.source_url);
		await page.getByRole('button', { name: 'Close Block Inserter', exact: true }).click();
		await page.getByRole('textbox', { name: 'Alternative text', exact: true })
			.fill('Native browser image');
		const save = page.getByRole('button', { name: 'Save draft', exact: true });
		await expect(save).toBeEnabled();
		const saved = page.waitForResponse(
			(r) =>
				new URL(r.url()).pathname.endsWith(`/wp/v2/zero_posts/${id}`) &&
				['POST', 'PUT'].includes(r.request().method())
		);
		await save.click();
		const response = await saved;
		expect(response.status(), await response.text()).toBe(200);
		await page.reload();
		await expect(
			editor.getByRole('textbox', { name: 'Add title', exact: true })
		).toHaveText(`${title} edited`);
		await expect(editor.getByRole('img', { name: 'Native browser image', exact: true }))
			.toHaveAttribute('src', media.source_url);
		const image = await request.get(media.source_url);
		expect(image.status()).toBe(200);
		expect(image.headers()['content-type']).toContain('image/png');
		await page.screenshot({
			path: test.info().outputPath('native-editor.png'),
		});
		const headers = {
			Authorization: `Basic ${Buffer.from(`editor:${harness.users.editor.appPassword}`).toString('base64')}`,
		};
		const persisted = await request.get(`${site}/wp-json/zero/v1/posts/${id}`, {
			headers,
		});
		expect(persisted.status()).toBe(200);
		expect((await persisted.json()).data).toMatchObject({
			title: `${title} edited`,
			excerpt: 'Edited in native Fields',
			authorId,
			sections: [{ layout: 'hero', heading: 'Native structured fields' }],
		});
		// The table uses the Zero endpoint and a readable cross-kind relation picker.
		await page.goto(`${site}/zero-admin/collections/comments`);
		await page
			.getByRole('button', { name: 'New comments', exact: false })
			.click();
		await page
			.getByRole('combobox', { name: 'Post Id', exact: true })
			.fill(title);
		await page
			.getByRole('option', { name: `${title} edited`, exact: true })
			.click();
		await page
			.getByRole('textbox', { name: 'Name', exact: true })
			.fill('Browser reader');
		await page
			.getByRole('textbox', { name: 'Body', exact: true })
			.fill('A table record from the browser');
		await page
			.getByRole('button', { name: 'Create record', exact: true })
			.click();
		await expect(page).toHaveURL(/\/collections\/comments\/\d+$/);
		await expect(
			page.getByRole('heading', { name: 'Edit Comments', exact: true })
		).toBeVisible();
		const commentId = new URL(page.url()).pathname.split('/').pop();
		await page
			.getByRole('textbox', { name: 'Body', exact: true })
			.fill('Edited table record');
		await page
			.getByRole('button', { name: 'Save changes', exact: true })
			.click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Saved.', { exact: true })
		).toBeVisible();
		await page.reload();
		await expect(
			page.getByRole('textbox', { name: 'Body', exact: true })
		).toHaveValue('Edited table record');
		await expect(
			page.getByRole('combobox', { name: 'Post Id', exact: true })
		).toHaveValue(`${title} edited`);
		await page.screenshot({ path: test.info().outputPath('table-edit.png') });
		const comment = await request.get(
			`${site}/wp-json/zero/v1/comments/${commentId}`,
			{ headers }
		);
		expect(comment.status()).toBe(200);
		expect((await comment.json()).data).toMatchObject({
			postId: Number(id),
			body: 'Edited table record',
		});
		// A rejected save keeps both the route and the draft; correction can retry.
		await page.getByRole('textbox', { name: 'Body', exact: true }).fill('http://rejected.example');
		await page.getByRole('link', { name: 'Back to Comments', exact: true }).click();
		const leave = page.getByRole('dialog');
		const refused = page.waitForResponse((r) =>
			new URL(r.url()).pathname.endsWith(`/zero/v1/comments/${commentId}`) &&
			['POST', 'PATCH'].includes(r.request().method()));
		await leave.getByRole('button', { name: 'Save changes', exact: true }).click();
		expect((await refused).status()).toBe(422);
		await expect(leave.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
		await expect(page).toHaveURL(`${site}/zero-admin/collections/comments/${commentId}`);
		await leave.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.getByRole('textbox', { name: 'Body', exact: true })).toHaveValue('http://rejected.example');
		await page.getByRole('textbox', { name: 'Body', exact: true }).fill('Corrected table record');
		await page.getByRole('link', { name: 'Back to Comments', exact: true }).click();
		await leave.getByRole('button', { name: 'Save changes', exact: true }).click();
		await expect(page).toHaveURL(`${site}/zero-admin/collections/comments`);
		const corrected = await request.get(`${site}/wp-json/zero/v1/comments/${commentId}`, { headers });
		expect((await corrected.json()).data.body).toBe('Corrected table record');
		// A reference may name a unique column instead of the target's primary key.
		const code = Date.now();
		const root = await request.post(`${site}/wp-json/zero/v1/key_roots`, {
			headers: adminHeaders, data: { code },
		});
		expect(root.status(), await root.text()).toBe(201);
		const rootId = (await root.json()).data.id;
		await page.context().clearCookies();
		await login(page, 'admin');
		await page.goto(`${site}/zero-admin/collections/key_links/-/new`);
		await page.getByRole('combobox', { name: 'Root Code', exact: true }).click();
		await page.getByRole('option', { name: `#${rootId}`, exact: true }).click();
		await page.getByRole('button', { name: 'Create record', exact: true }).click();
		await expect(page).toHaveURL(/\/collections\/key_links\/\d+$/);
		const linkId = new URL(page.url()).pathname.split('/').pop();
		await page.reload();
		await expect(page.getByRole('combobox', { name: 'Root Code', exact: true }))
			.toHaveValue(`#${rootId}`);
		const link = await request.get(`${site}/wp-json/zero/v1/key_links/${linkId}`, {
			headers: adminHeaders,
		});
		expect(link.status()).toBe(200);
		expect((await link.json()).data.rootCode).toBe(code);
		expect(errors).toEqual([]);
	});
	test('native and plain JSON drafts survive validation, undo and navigation', async ({
		page,
		request,
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		const adminHeaders = {
			Authorization: `Basic ${Buffer.from(`admin:${harness.users.admin.appPassword}`).toString('base64')}`,
		};
		await login(page, 'admin');
		// Invalid JSON is an unsaved draft even when core-data has no edits.
		const event = await request.post(`${site}/wp-json/zero/v1/dossier`, {
			headers: adminHeaders, data: { title: 'JSON browser draft', payload: { committed: true }, entries: [], sections: [{ layout: 'first', configuration: { initial: true } }] },
		});
		expect(event.status(), await event.text()).toBe(201);
		const eventId = (await event.json()).data.id;
		await page.goto(`${site}/zero-admin/collections/dossier/${eventId}`);
		const jsonFields = page.getByRole('button', { name: 'Fields', exact: true });
		await expect(jsonFields).toBeVisible();
		if ((await jsonFields.getAttribute('aria-expanded')) !== 'true') await jsonFields.click();
		const payload = page.locator('.zero-schema-json').filter({ hasText: 'Payload' }).locator('textarea');
		await expect(payload).toHaveValue(JSON.stringify({ committed: true }, null, 2));
		await payload.fill('unfinished');
		await expect(page.getByRole('alert').filter({ hasText: 'Enter valid JSON' })).toBeVisible();
		const eventSave = page.getByRole('button', { name: /^(Save|Save draft|Update)$/ }).last();
		await expect(eventSave).toBeDisabled();
		await jsonFields.click();
		await expect(eventSave).toBeDisabled();
		await jsonFields.click();
		await expect(payload).toHaveValue('unfinished');
		await page.getByRole('link', { name: 'Go back', exact: true }).click();
		await expect(page.getByRole('dialog')).toContainText('Fix errors before leaving?');
		await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
		await expect(payload).toHaveValue('unfinished');
		await payload.fill('false');
		await expect(eventSave).toBeEnabled();
		const sections = page.getByRole('group', { name: 'Sections', exact: true });
		const configuration = sections.locator('textarea');
		await configuration.fill('unfinished layout');
		await expect(eventSave).toBeDisabled();
		await sections.getByRole('combobox', { name: 'Layout' }).selectOption('second');
		await expect(configuration).toHaveValue('null');
		await expect(configuration).toHaveAttribute('aria-invalid', 'false');
		await expect(eventSave).toBeEnabled();
		const jsonSaved = page.waitForResponse((r) =>
			new URL(r.url()).pathname.endsWith(`/wp/v2/zero_dossier/${eventId}`) &&
			['POST', 'PUT'].includes(r.request().method()));
		await eventSave.click();
		expect((await jsonSaved).status()).toBe(200);
		const eventRead = await request.get(`${site}/wp-json/zero/v1/dossier/${eventId}`, { headers: adminHeaders });
		const savedEvent = (await eventRead.json()).data;
		expect(savedEvent.payload).toBe(false);
		expect(savedEvent.sections).toEqual([{ layout: 'second', configuration: null }]);
		await page.reload();
		if ((await jsonFields.getAttribute('aria-expanded')) !== 'true') await jsonFields.click();
		await expect(payload).toHaveValue(JSON.stringify(savedEvent.payload, null, 2));
		await payload.fill('{"edited":true}');
		await page.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(payload).toHaveValue(JSON.stringify(savedEvent.payload, null, 2));
		await expect(sections.locator('textarea').first()).toHaveValue('null');
		await page.getByRole('button', { name: 'Add Sections', exact: true }).click();
		const siblingSaved = page.waitForResponse((r) =>
			new URL(r.url()).pathname.endsWith(`/wp/v2/zero_dossier/${eventId}`) &&
			['POST', 'PUT'].includes(r.request().method()));
		await eventSave.click();
		expect((await siblingSaved).status()).toBe(200);
		const siblingRead = await request.get(`${site}/wp-json/zero/v1/dossier/${eventId}`, { headers: adminHeaders });
		expect((await siblingRead.json()).data).toMatchObject({
			payload: savedEvent.payload,
			sections: [{ layout: 'second', configuration: null }, { layout: 'first', configuration: null }],
		});
		await page.getByRole('button', { name: 'Add Entries', exact: true }).click();
		await page.getByRole('group', { name: 'Entries', exact: true }).locator('textarea').fill('unfinished row');
		await expect(eventSave).toBeDisabled();
		await jsonFields.click();
		await page.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(() => page.evaluate<{ saving: boolean; autosaving: boolean }>(
			`({ saving: wp.data.select('core/editor').isPostSavingLocked(), autosaving: wp.data.select('core/editor').isPostAutosavingLocked() })`
		)).toEqual({ saving: false, autosaving: false });
		await jsonFields.click();
		await expect(page.getByRole('group', { name: 'Entries', exact: true }).locator('textarea')).toHaveCount(0);
		await page.screenshot({ path: test.info().outputPath('retired-json-drafts.png'), animations: 'disabled' });
		// Plain forms use the same document-level leave flow, including invalid-only drafts.
		const plain = await request.post(`${site}/wp-json/zero/v1/events`, {
			headers: adminHeaders, data: { title: 'Plain saved title', extra: { saved: true } },
		});
		expect(plain.status(), await plain.text()).toBe(201);
		const plainId = (await plain.json()).data.id;
		await page.goto(`${site}/zero-admin/collections/events/${plainId}`);
		const extra = page.locator('.zero-schema-json').filter({ hasText: 'Extra' }).locator('textarea');
		await extra.fill('plain invalid-only draft');
		await expect(extra).toHaveAttribute('aria-invalid', 'true');
		const leaving = page.waitForEvent('dialog');
		const classicClick = page.getByRole('link', { name: 'Classic admin', exact: true }).click();
		const warning = await leaving;
		expect(warning.type()).toBe('beforeunload');
		await warning.dismiss();
		await classicClick;
		await expect(page).toHaveURL(`${site}/zero-admin/collections/events/${plainId}`);
		await expect(extra).toHaveValue('plain invalid-only draft');
		await page.getByRole('link', { name: 'Back to Events', exact: true }).click();
		await expect(page.getByRole('dialog')).toContainText('Fix errors before leaving?');
		await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
		await expect(extra).toHaveValue('plain invalid-only draft');
		await page.getByRole('link', { name: 'Back to Events', exact: true }).click();
		await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
		await expect(page).toHaveURL(`${site}/zero-admin/collections/events`);
		await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
		await expect.poll(() => page.evaluate(() => {
			const event = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(event);
			return event.defaultPrevented;
		})).toBe(false);
		await page.goto(`${site}/zero-admin/collections/events/${plainId}`);
		await expect(extra).toHaveValue(JSON.stringify({ saved: true }, null, 2));
		await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Plain saved on leave');
		await page.getByRole('link', { name: 'Back to Events', exact: true }).click();
		await expect(page.getByRole('dialog')).toContainText('Save changes before leaving?');
		const plainSaved = page.waitForResponse((r) =>
			new URL(r.url()).pathname.endsWith(`/wp/v2/zero_events/${plainId}`) &&
			r.request().method() === 'POST');
		await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click();
		expect((await plainSaved).status()).toBe(200);
		await expect(page).toHaveURL(`${site}/zero-admin/collections/events`);
		const plainRead = await request.get(`${site}/wp-json/zero/v1/events/${plainId}`, { headers: adminHeaders });
		expect((await plainRead.json()).data).toMatchObject({ title: 'Plain saved on leave', extra: { saved: true } });
		expect(errors).toEqual([]);
	});
	test('field masking permits authorized edits and denies restricted collection access', async ({
		page,
		request,
	}) => {
		const postTitle = `Read-only browser ${Date.now()}`;
		const seeded = await request.post(`${site}/wp-json/zero/v1/posts`, {
			headers: {
				Authorization: `Basic ${Buffer.from(`editor:${harness.users.editor.appPassword}`).toString('base64')}`,
			},
			data: { title: postTitle, status: 'published' },
		});
		expect(seeded.status(), await seeded.text()).toBe(201);
		const { id } = (await seeded.json()).data;
		const title = `Readable dossier ${Date.now()}`;
		const dossier = await request.post(`${site}/wp-json/zero/v1/dossier`, {
			headers: {
				Authorization: `Basic ${Buffer.from(`admin:${harness.users.admin.appPassword}`).toString('base64')}`,
			},
			data: { title, body: '<p>Private original body</p>' },
		});
		expect(dossier.status(), await dossier.text()).toBe(201);
		const dossierId = (await dossier.json()).data.id;
		const claimTitle = `Readable foreign claim ${Date.now()}`;
		const claim = await request.post(`${site}/wp-json/zero/v1/claims`, {
			headers: { Authorization: `Basic ${Buffer.from(`admin:${harness.users.admin.appPassword}`).toString('base64')}` },
			data: { title: claimTitle, ownerId: harness.users.admin.id, meta: {} },
		});
		expect(claim.status(), await claim.text()).toBe(201);
		const claimId = (await claim.json()).data.id;
		await login(page, 'subscriber');
		await expect(
			page.getByRole('link', { name: 'signups', exact: true })
		).toHaveCount(0);
		await page.goto(`${site}/zero-admin/collections/signups`);
		await expect(page.getByRole('alert')).toContainText(
			/access|permission|forbidden/i
		);
		await expect(
			page.getByRole('button', { name: /New signups/i })
		).toHaveCount(0);
		await page.goto(`${site}/zero-admin/collections/posts/${id}`);
		await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(postTitle);
		await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeDisabled();
		await page.goto(`${site}/zero-admin/collections/dossier/${dossierId}`);
		await expect(page.getByRole('textbox', { name: 'Title', exact: true }))
			.toHaveValue(title);
		await expect(page.getByRole('textbox', { name: 'Title', exact: true }))
			.toBeDisabled();
		await expect(page.getByRole('button', { name: 'Save changes', exact: true }))
			.toBeDisabled();
		await expect(
			page.getByRole('button', { name: 'Publish', exact: true })
		).toHaveCount(0);
		await page.context().clearCookies();
		await login(page, 'editor');
		await page.goto(`${site}/zero-admin/collections/dossier/${dossierId}`);
		await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeEnabled();
		await expect(page.getByRole('textbox', { name: 'Body', exact: true })).toHaveCount(0);
		await page.getByRole('textbox', { name: 'Title', exact: true }).fill(`${title} edited`);
		await page.getByRole('button', { name: 'Save changes', exact: true }).click();
		await expect(page.locator('.components-notice__content').getByText('Saved.', { exact: true })).toBeVisible();
		const readback = await request.get(`${site}/wp-json/zero/v1/dossier/${dossierId}`, {
			headers: { Authorization: `Basic ${Buffer.from(`admin:${harness.users.admin.appPassword}`).toString('base64')}` },
		});
		expect((await readback.json()).data).toMatchObject({ title: `${title} edited`, body: '<p>Private original body</p>' });
		await page.goto(`${site}/zero-admin/collections/claims`);
		await page.getByRole('link', { name: claimTitle, exact: true }).first().click();
		await expect(page).toHaveURL(`${site}/zero-admin/collections/claims/${claimId}`);
		await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(claimTitle);
		await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
		await page.reload();
		await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(claimTitle);
		await page.screenshot({ path: test.info().outputPath('readable-rule-record.png'), animations: 'disabled' });
		const denied = await request.patch(`${site}/wp-json/zero/v1/claims/${claimId}`, {
			headers: { Authorization: `Basic ${Buffer.from(`editor:${harness.users.editor.appPassword}`).toString('base64')}` },
			data: { title: 'Forbidden update' },
		});
		// Row-filtered updates conceal rows outside the caller's update scope.
		expect(denied.status()).toBe(404);
		const claimReadback = await request.get(`${site}/wp-json/zero/v1/claims/${claimId}`, {
			headers: { Authorization: `Basic ${Buffer.from(`editor:${harness.users.editor.appPassword}`).toString('base64')}` },
		});
		expect(claimReadback.status()).toBe(200);
		expect((await claimReadback.json()).data.title).toBe(claimTitle);
	});
	test('global and media forms save through their canonical APIs', async ({
		page,
		request,
	}) => {
		await login(page, 'editor');
		const headers = {
			Authorization: `Basic ${Buffer.from(`editor:${harness.users.editor.appPassword}`).toString('base64')}`,
		};
		await page.getByRole('link', { name: 'Globals', exact: true }).click();
		await page
			.getByRole('link', { name: 'Site settings', exact: true })
			.click();
		await page
			.getByRole('textbox', { name: 'Tagline', exact: true })
			.fill(`Saved from the browser ${Date.now()}`);
		await page
			.getByRole('button', { name: 'Save changes', exact: true })
			.click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Saved.', { exact: true })
		).toBeVisible();
		await page.reload();
		await expect(
			page.getByRole('textbox', { name: 'Tagline', exact: true })
		).toHaveValue(/Saved from the browser/);
		const global = await request.get(
			`${site}/wp-json/zero/v1/globals/settings`,
			{ headers }
		);
		expect((await global.json()).data.tagline).toMatch(
			/^Saved from the browser/
		);
		await page.getByRole('link', { name: 'Media', exact: true }).click();
		const name = `browser-${Date.now()}`;
		const uploaded = page.waitForResponse(
				(r) =>
					r.url().includes('/zero/v1/media') && r.request().method() === 'POST' && r.status() === 201
		);
		const chooser = page.waitForEvent('filechooser');
		await page
			.getByRole('button', { name: 'Add Media File', exact: true })
			.click();
		await (
			await chooser
		).setFiles([{
			name: `${name}.png`,
			mimeType: 'image/png',
			buffer: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
				'base64'
			),
		}, {
			name: `${name}.exe`, mimeType: 'application/octet-stream',
			buffer: Buffer.from('Not an allowed media file'),
		}]);
		const uploadResponse = await uploaded;
		expect(uploadResponse.status(), await uploadResponse.text()).toBe(201);
		const mediaId = (await uploadResponse.json()).data.id;
		await expect(page.locator('.components-notice.is-error'))
			.toContainText(/not allowed|invalid|file type|mime|upload/i);
		await page.getByRole('link', { name, exact: true }).click();
		await expect(page).toHaveURL(`${site}/zero-admin/media/${mediaId}`);
		await page
			.getByRole('textbox', { name: 'Alt text', exact: true })
			.fill('Browser image description');
		await page.getByRole('button', { name: 'Save media', exact: true }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Media saved.', { exact: true })
		).toBeVisible();
		await page.reload();
		await expect(
			page.getByRole('textbox', { name: 'Alt text', exact: true })
		).toHaveValue('Browser image description');
		const media = await request.get(
			`${site}/wp-json/zero/v1/media/${mediaId}`,
			{ headers }
		);
		expect((await media.json()).data.alt).toBe('Browser image description');
		// Media and native captions share one leave flow, with independent save baselines.
		const alt = page.getByRole('textbox', { name: 'Alt text', exact: true });
		const caption = page.getByRole('textbox', { name: 'Caption', exact: true });
		const originalCaption = await caption.inputValue();
		await alt.fill('Saved on media leave');
		await caption.fill('Saved caption on leave');
		await expect.poll(() => page.evaluate(() => {
			const event = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(event);
			return event.defaultPrevented;
		})).toBe(true);
		// Send a genuinely invalid native payload: WordPress rejects it after Zero saves.
		const captionUrl = (url: URL) => url.pathname.endsWith(`/wp/v2/media/${mediaId}`);
		await page.route(captionUrl, async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			const data: unknown = route.request().postDataJSON();
			if (!data || typeof data !== 'object') throw new Error('Expected caption request.');
			await route.continue({ postData: JSON.stringify({ ...data, status: 'not-a-wordpress-status' }) });
		});
		await page.getByRole('link', { name: 'Back to Media', exact: true }).click();
		const leave = page.getByRole('dialog');
		const failedCaption = page.waitForResponse((r) => captionUrl(new URL(r.url())) && r.request().method() === 'POST');
		await leave.getByRole('button', { name: 'Save changes', exact: true }).click();
		expect((await failedCaption).status()).toBe(400);
		await expect(leave.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
		await expect(page).toHaveURL(`${site}/zero-admin/media/${mediaId}`);
		await leave.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(caption).toHaveValue('Saved caption on leave');
		const partial = await request.get(`${site}/wp-json/zero/v1/media/${mediaId}`, { headers });
		expect((await partial.json()).data.alt).toBe('Saved on media leave');
		await page.unroute(captionUrl);
		await caption.fill(originalCaption);
		await expect.poll(() => page.evaluate(() => {
			const event = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(event);
			return event.defaultPrevented;
		})).toBe(false);
		await caption.fill('Saved caption on leave');
		await page.getByRole('link', { name: 'Back to Media', exact: true }).click();
		await leave.getByRole('button', { name: 'Save changes', exact: true }).click();
		await expect(page).toHaveURL(`${site}/zero-admin/media`);
		const coreMedia = await request.get(`${site}/wp-json/wp/v2/media/${mediaId}?context=edit`, { headers });
		expect((await coreMedia.json()).caption.raw).toBe('Saved caption on leave');
		await expect.poll(() => page.evaluate(() => {
			const event = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(event);
			return event.defaultPrevented;
		})).toBe(false);
		await page.getByRole('link', { name, exact: true }).click();
		await expect(alt).toHaveValue('Saved on media leave');
		await alt.fill('Discard this media draft');
		await page.getByRole('link', { name: 'Back to Media', exact: true }).click();
		await leave.getByRole('button', { name: 'Discard changes', exact: true }).click();
		await expect(page).toHaveURL(`${site}/zero-admin/media`);
		await page.getByRole('link', { name, exact: true }).click();
		await expect(alt).toHaveValue('Saved on media leave');
		await page.screenshot({ path: test.info().outputPath('media-details.png') });
		// Confirmed deletion retires even dirty drafts without a second leave prompt.
		await alt.fill('Deleted media draft');
		await page
			.getByRole('button', { name: 'Delete media', exact: true })
			.click();
		await page
			.getByRole('button', { name: 'Confirm delete', exact: true })
			.click();
		await expect(page).toHaveURL(`${site}/zero-admin/media`);
		await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
	});
}
