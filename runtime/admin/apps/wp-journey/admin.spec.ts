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
	await page.getByRole('link', { name: 'Posts', exact: true }).last().click();
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
		if (!(await excerpt.isVisible())) {
			await page.getByRole('button', { name: 'Fields', exact: true }).click();
		}
		await page
			.getByRole('textbox', { name: 'Excerpt', exact: true })
			.fill('Edited in native Fields');
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
		// A reference may name a unique column instead of the target's primary key.
		const adminHeaders = {
			Authorization: `Basic ${Buffer.from(`admin:${harness.users.admin.appPassword}`).toString('base64')}`,
		};
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
	test('a subscriber sees explicit denial for an editor-only collection', async ({
		page,
		request,
	}) => {
		const seeded = await request.post(`${site}/wp-json/zero/v1/posts`, {
			headers: {
				Authorization: `Basic ${Buffer.from(`editor:${harness.users.editor.appPassword}`).toString('base64')}`,
			},
			data: { title: `Read-only browser ${Date.now()}`, status: 'published' },
		});
		expect(seeded.status(), await seeded.text()).toBe(201);
		const { id } = (await seeded.json()).data;
		const title = `Readable dossier ${Date.now()}`;
		const dossier = await request.post(`${site}/wp-json/zero/v1/dossier`, {
			headers: {
				Authorization: `Basic ${Buffer.from(`admin:${harness.users.admin.appPassword}`).toString('base64')}`,
			},
			data: { title },
		});
		expect(dossier.status(), await dossier.text()).toBe(201);
		const dossierId = (await dossier.json()).data.id;
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
		await expect(page.getByRole('alert')).toContainText(
			/not allowed|permission|forbidden/i
		);
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
		await page.screenshot({
			path: test.info().outputPath('media-details.png'),
		});
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
