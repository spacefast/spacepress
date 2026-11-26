import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { submitSignIn } from './sign-in';

const harness = JSON.parse(readFileSync(process.env.SP_WP_HARNESS ??
	fileURLToPath(new URL('../../../../tests/wp/.harness.json', import.meta.url)), 'utf8'));
const site: string = harness.url;
const headers = { Authorization: `Basic ${Buffer.from(`admin:${harness.users.admin.appPassword}`).toString('base64')}` };

async function signIn(page: Page, role: 'admin' | 'editor' = 'admin') {
	await page.goto(`${site}/wp-login.php`);
	await submitSignIn(page, role, `spacepress-test-${role}`);
	await expect(page).toHaveURL(`${site}/wp-admin/new/`);
}

async function hideColumn(page: Page, label: string) {
	await expect(page.getByRole('columnheader', { name: label, exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'View options', exact: true }).click();
	const saved = page.waitForResponse(r => r.url().includes('/wp/v2/users/') && r.request().method() === 'POST');
	await page.locator('.dataviews-view-config').getByRole('button', { name: label, exact: true }).click();
	expect((await saved).ok()).toBe(true);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('columnheader', { name: label, exact: true })).toHaveCount(0);
}

async function resetView(page: Page) {
	await page.getByRole('button', { name: 'View options', exact: true }).click();
	const reset = page.getByRole('button', { name: 'Reset view', exact: true });
	if (await reset.count() && await reset.isEnabled()) {
		const saved = page.waitForResponse(r => r.url().includes('/wp/v2/users/') && r.request().method() === 'POST');
		await reset.click();
		expect((await saved).ok()).toBe(true);
	}
	await page.keyboard.press('Escape');
}

async function newSession(browser: Browser, path: string, label: string, hidden: boolean, role: 'admin' | 'editor' = 'admin') {
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await signIn(page, role);
		await page.goto(`${site}${path}`);
		await expect(page.getByRole('button', { name: 'View options', exact: true })).toBeVisible();
		await expect(page.getByRole('columnheader', { name: label, exact: true })).toHaveCount(hidden ? 0 : 1);
	} finally {
		await context.close();
	}
}

test.beforeAll(async ({ request }) => {
	const author = await request.post(`${site}/wp-json/spacepress/v1/authors`, {
		headers, data: { name: `View author ${Date.now()}`, email: `views-${Date.now()}@example.test` },
	});
	expect(author.status(), await author.text()).toBe(201);
	const image = await request.post(`${site}/wp-json/wp/v2/media`, {
		headers: { ...headers, 'Content-Disposition': 'attachment; filename="view-state.png"', 'Content-Type': 'image/png' },
		data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
	});
	expect(image.status(), await image.text()).toBe(201);
	const post = await request.post(`${site}/wp-json/spacepress/v1/posts`, { headers, data: { title: `View post ${Date.now()}` } });
	expect(post.status(), await post.text()).toBe(201);
	const comment = await request.post(`${site}/wp-json/spacepress/v1/comments`, {
		headers: { Authorization: `Basic ${Buffer.from(`subscriber:${harness.users.subscriber.appPassword}`).toString('base64')}` },
		data: { postId: (await post.json()).data.id, name: 'View reader', body: `View comment ${Date.now()}` },
	});
	expect(comment.status(), await comment.text()).toBe(201);
});

test('collection columns persist across reload and fresh sessions, separately for each user', async ({ page, browser }) => {
	await signIn(page);
	const path = '/wp-admin/new/collections/authors';
	const column = 'Published At';
	await page.goto(`${site}${path}`);
	await resetView(page);
	await hideColumn(page, column);
	await page.reload();
	await expect(page.getByRole('button', { name: 'View options', exact: true })).toBeVisible();
	await expect(page.getByRole('columnheader', { name: column, exact: true })).toHaveCount(0);
	await newSession(browser, path, column, true);
	await newSession(browser, path, column, false, 'editor');
	await page.getByRole('button', { name: 'View options', exact: true }).click();
	const saved = page.waitForResponse(r => r.url().includes('/wp/v2/users/') && r.request().method() === 'POST');
	await page.getByRole('button', { name: 'Reset view', exact: true }).click();
	expect((await saved).ok()).toBe(true);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
});

test('media remembers columns and sends its saved page size to WordPress after reload', async ({ page, browser }) => {
	await signIn(page);
	const path = '/wp-admin/new/media';
	await page.goto(`${site}${path}`);
	await resetView(page);
	// Media opens as a grid; columns are a table-layout setting, and the chosen layout is saved too.
	const layoutSaved = page.waitForResponse(r => r.url().includes('/wp/v2/users/') && r.request().method() === 'POST');
	await page.getByRole('button', { name: 'Layout', exact: true }).click();
	await page.getByRole('menuitemradio', { name: 'Table', exact: true }).click();
	expect((await layoutSaved).ok()).toBe(true);
	await hideColumn(page, 'Type');
	await page.getByRole('button', { name: 'View options', exact: true }).click();
	const saved = page.waitForResponse(r => r.url().includes('/wp/v2/users/') && r.request().method() === 'POST');
	const query = page.waitForResponse(r => r.url().includes('/wp/v2/media?') && new URL(r.url()).searchParams.get('per_page') === '10');
	await page.getByRole('radio', { name: '10', exact: true }).click();
	expect((await saved).ok()).toBe(true);
	expect((await query).ok()).toBe(true);
	const reloaded = page.waitForResponse(r => r.url().includes('/wp/v2/media?') && new URL(r.url()).searchParams.get('per_page') === '10');
	await page.reload();
	expect((await reloaded).ok()).toBe(true);
	await expect(page.getByRole('button', { name: 'View options', exact: true })).toBeVisible();
	await expect(page.getByRole('columnheader', { name: 'Uploaded', exact: true })).toBeVisible();
	await expect(page.getByRole('columnheader', { name: 'Type', exact: true })).toHaveCount(0);
	await newSession(browser, path, 'Type', true);
});

test('custom screens share saved columns between SpacePress and classic admin', async ({ page, browser, request }) => {
	await signIn(page);
	await page.goto(`${site}/wp-admin/new/screens/test-comments`);
	await resetView(page);
	await hideColumn(page, 'Approved');
	// Classic wp-admin opens on its own only in developer mode; otherwise it is framed in SpacePress Admin.
	const developerMode = (on: boolean) => request.post(`${site}/wp-json/wp/v2/users/me`, { headers, data: { sp_admin_developer_mode: on } });
	expect((await developerMode(true)).status()).toBe(200);
	try {
		const classic = '/wp-admin/admin.php?page=spacepress-screen-test-comments';
		await page.goto(`${site}${classic}`);
		await expect(page.getByRole('button', { name: 'View options', exact: true })).toBeVisible();
		await expect(page.getByRole('columnheader', { name: 'Approved', exact: true })).toHaveCount(0);
		await newSession(browser, classic, 'Approved', true);
	} finally {
		await developerMode(false);
	}
});
