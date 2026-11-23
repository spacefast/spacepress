import { test, expect, type Page, type Response } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { submitSignIn } from './sign-in';
import { map, object } from '../packages/schema/src/model';

const harness = object(JSON.parse(readFileSync(process.env.SP_WP_HARNESS ??
	fileURLToPath(new URL('../../../../tests/wp/.harness.json', import.meta.url)), 'utf8')));
if (typeof harness.url !== 'string') throw new Error('Missing fixture URL.');
const site = harness.url;
const apiUrl = `${site}/wp-json/spacepress/v1`;
const users = object(harness.users);
const adminId = object(users.admin).id;
const editorId = object(users.editor).id;
if (typeof adminId !== 'number' || typeof editorId !== 'number') throw new Error('Missing fixture user ids.');
function auth(role: 'admin') {
	const password = object(users[role]).appPassword;
	if (typeof password !== 'string') throw new Error('Missing fixture application password.');
	return { Authorization: `Basic ${Buffer.from(`${role}:${password}`).toString('base64')}` };
}
const title = (page: Page) => page.frameLocator('iframe[name="editor-canvas"]')
	.getByRole('textbox', { name: 'Add title', exact: true });
const paragraph = (page: Page) => page.frameLocator('iframe[name="editor-canvas"]')
	.locator('[data-type="core/paragraph"][contenteditable="true"]');

async function open(page: Page, role: 'admin' | 'editor', id: number) {
	await page.goto(`${site}/wp-login.php`);
	await submitSignIn(page, role, `spacepress-test-${role}`);
	await page.goto(`${site}/wp-admin/new/collections/documents/${id}`);
	await expect(title(page)).toBeVisible();
	const fields = page.getByRole('button', { name: 'Fields', exact: true });
	if (await fields.getAttribute('aria-expanded') !== 'true') await fields.click();
	await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toBeVisible();
}

test('upstream collaboration merges simultaneous text edits, shares fields, and saves through SpacePress', async ({ browser, request }) => {
	const run = Date.now();
	const created = await request.post(`${apiUrl}/documents`, {
		headers: auth('admin'),
		data: { status: 'draft', title: `Coediting ${run}`, body: '<!-- wp:paragraph --><p>Shared paragraph</p><!-- /wp:paragraph -->', summary: 'Initial summary' },
	});
	expect(created.status(), await created.text()).toBe(201);
	const row = object(object(await created.json()).data);
	if (typeof row.id !== 'number') throw new Error('Fixture did not create a numeric document id.');
	const id = row.id;
	const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
	const pages = await Promise.all(contexts.map((context) => context.newPage()));
	const errors: string[] = [];
	const failedSync: number[] = [];
	const successfulSyncHeaders: string[] = [];
	const peers = new Set<number>();
	for (const page of pages) {
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('response', (response) => {
			if (!new URL(response.url()).pathname.includes('/wp-sync/v1/')) return;
			if (!response.ok()) failedSync.push(response.status());
			const schema = response.request().headers()['x-spacepress-coediting-schemas'];
			if (response.ok() && schema) successfulSyncHeaders.push(schema);
		});
	}
	const collectPeers = async (response: Response) => {
		if (!response.ok() || !new URL(response.url()).pathname.endsWith('/wp-sync/v1/updates')) return;
		const payload = object(await response.json());
		if (!Array.isArray(payload.rooms)) return;
		for (const raw of payload.rooms) {
			const awareness = map(object(raw).awareness ?? {});
			for (const value of Object.values(awareness)) {
				if (Array.isArray(value)) continue;
				const user = object(object(value).collaboratorInfo ?? {});
				if (typeof user.id === 'number') peers.add(user.id);
			}
		}
	};
	const stopReadingPeers = () => Promise.all(contexts.map((context) =>
		context.removeAllListeners('response', { behavior: 'wait' })));
	try {
		await open(pages[0], 'editor', id);
		await open(pages[1], 'admin', id);
		for (const context of contexts) context.on('response', collectPeers);
		await expect(paragraph(pages[0])).toHaveText('Shared paragraph');
		await expect(paragraph(pages[1])).toHaveText('Shared paragraph');

		// Both clients have a poll held before either edit, so neither can receive the other's text first.
		let release = () => {};
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const held = [false, false];
		for (const [index, context] of contexts.entries()) {
			await context.route('**/wp-sync/v1/updates*', async (route) => {
				held[index] = true;
				await gate;
				await route.continue();
			});
		}
		try {
			await expect.poll(() => held.every(Boolean)).toBe(true);
			await paragraph(pages[0]).click();
			await pages[0].keyboard.press('End');
			await pages[0].keyboard.type(` editor-${run}`);
			await paragraph(pages[1]).click();
			await pages[1].keyboard.press('End');
			await pages[1].keyboard.type(` admin-${run}`);
			await expect(paragraph(pages[0])).not.toContainText(`admin-${run}`);
			await expect(paragraph(pages[1])).not.toContainText(`editor-${run}`);
		} finally { release(); }
		for (const page of pages) {
			await expect(paragraph(page)).toContainText(`editor-${run}`);
			await expect(paragraph(page)).toContainText(`admin-${run}`);
		}
		await title(pages[0]).fill(`Shared title ${run}`);
		await pages[1].getByRole('tab', { name: 'Documents', exact: true }).click();
		await pages[1].getByRole('textbox', { name: 'Summary', exact: true }).fill(`Shared summary ${run}`);
		await expect(title(pages[1])).toHaveText(`Shared title ${run}`);
		await expect(pages[0].getByRole('textbox', { name: 'Summary', exact: true })).toHaveValue(`Shared summary ${run}`);
		await expect.poll(() => peers.has(adminId) && peers.has(editorId)).toBe(true);
		// A navigation can invalidate response bodies. Finish reading peer updates before saving or reloading.
		await stopReadingPeers();
		// The normal REST record is still unchanged: these checks prove sharing before the user saves.
		const before = await request.get(`${site}/wp-json/wp/v2/sp_documents/${id}?context=edit`, { headers: auth('admin') });
		expect(before.ok()).toBe(true);
		const unsaved = object(await before.json());
		expect(object(unsaved.title).raw).toBe(`Coediting ${run}`);
		expect(object(unsaved.meta).summary).toBe('Initial summary');

		const saving = pages[0].waitForResponse((response) =>
			new URL(response.url()).pathname.endsWith(`/wp/v2/sp_documents/${id}`) && response.request().method() === 'POST');
		await pages[0].getByRole('button', { name: 'Save draft', exact: true }).click();
		const saved = await saving;
		expect(saved.status(), await saved.text()).toBe(200);
		expect(saved.request().headers()['x-spacepress-coediting-schemas']).toBeTruthy();
		const read = await request.get(`${apiUrl}/documents/${id}`, { headers: auth('admin') });
		expect(read.ok()).toBe(true);
		const persisted = object(object(await read.json()).data);
		expect(persisted.title).toBe(`Shared title ${run}`);
		expect(persisted.summary).toBe(`Shared summary ${run}`);
		expect(persisted.body).toContain(`editor-${run}`);
		expect(persisted.body).toContain(`admin-${run}`);
		const history = await request.get(`${apiUrl}/documents/${id}/revisions`, { headers: auth('admin') });
		expect(history.ok()).toBe(true);
		const versions: unknown = object(await history.json()).data;
		expect(Array.isArray(versions) && versions.length >= 2).toBe(true);
		const audit = await request.get(`${apiUrl}/edits?${new URLSearchParams({ where: JSON.stringify({ documentId: id }) })}`, { headers: auth('admin') });
		expect(audit.ok()).toBe(true);
		const logs: unknown = object(await audit.json()).data;
		if (!Array.isArray(logs)) throw new Error('Expected fixture audit rows.');
		const edits = logs.map(object);
		expect(edits).toEqual([expect.objectContaining({ title: `Shared title ${run}`, summary: `Shared summary ${run}`, actor: 'Editor' })]);
		await pages[1].reload();
		await expect(title(pages[1])).toHaveText(`Shared title ${run}`);
		await expect(paragraph(pages[1])).toContainText(`editor-${run}`);
		await expect(paragraph(pages[1])).toContainText(`admin-${run}`);
		await title(pages[1]).fill(`Rejoined title ${run}`);
		await expect(title(pages[0])).toHaveText(`Rejoined title ${run}`);
		const afterRejoin = await request.get(`${site}/wp-json/wp/v2/sp_documents/${id}?context=edit`, { headers: auth('admin') });
		expect(object(object(await afterRejoin.json()).title).raw).toBe(`Shared title ${run}`);
		expect(successfulSyncHeaders.length).toBeGreaterThan(0);
		expect(failedSync).toEqual([]);
		expect(errors).toEqual([]);
		await pages[0].screenshot({ path: test.info().outputPath('coediting-editor.png'), animations: 'disabled' });
		await pages[1].screenshot({ path: test.info().outputPath('coediting-admin.png'), animations: 'disabled' });
	} finally {
		try {
			await stopReadingPeers();
		} finally {
			await Promise.all(contexts.map((context) => context.close()));
		}
	}
});

test('a taxonomy without core REST keeps its assignments through the SpacePress form transport', async ({ page, request }) => {
	const run = Date.now();
	const tags = object(harness.coeditingTags);
	if (typeof tags.initial !== 'number' || typeof tags.replacement !== 'number')
		throw new Error('Expected the fixture terms seeded by WP-CLI without REST.');
	const ids = [tags.initial, tags.replacement];
	const created = await request.post(`${apiUrl}/articles`, {
		headers: auth('admin'), data: { title: `Taxonomy ${run}`, labels: [ids[0]] },
	});
	expect(created.status(), await created.text()).toBe(201);
	const article = object(object(await created.json()).data);
	if (typeof article.id !== 'number') throw new Error('Expected a fixture article id.');
	await page.goto(`${site}/wp-login.php`);
	await submitSignIn(page, 'admin', 'spacepress-test-admin');
	await page.goto(`${site}/wp-admin/new/collections/articles/${article.id}`);
	await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(`Taxonomy ${run}`);
	const result = await page.evaluate(async ({ id, replacement }) => {
		const moduleName = '@spacepress-admin/schema';
		const api: typeof import('../packages/schema/src/api') = await import(moduleName);
		const spec = await api.collectionSpec('articles');
		const before = await api.read(spec, String(id));
		const after = await api.save(spec, { labels: [replacement] }, String(id));
		return { before: before.row.labels, after: after.labels, native: api.native('articles') ?? null };
	}, { id: article.id, replacement: ids[1] });
	expect(result).toEqual({ before: [ids[0]], after: [ids[1]], native: null });
	const saved = await request.get(`${apiUrl}/articles/${article.id}`, { headers: auth('admin') });
	expect(object(object(await saved.json()).data).labels).toEqual([ids[1]]);
});
