import { test, expect, type Page } from "@playwright/test";

import { pick } from "../tree.ts";

const plugins = "tp/dist/wp-content/plugins";
// A row of the file tree, by its full path. Rows live in the tree's shadow root, and a row's text is
// split for truncation, so they are found by path rather than by text.
const row = (page: Page, path: string) => page.locator(`.explorer [role="treeitem"][data-item-path="${path}"]`);
const viewer = (page: Page) => page.locator(".explorer-loaded");

test("the landing page opens on the config, written out when the site was built", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("./");
	const config = page.locator(".explorer-config");
	await expect(config).toBeVisible();
	await expect(config).toContainText('import { mine, ownerId, signedIn } from "./tp/lib/owner"');
	// The whole config is on the page: its last line is there without scrolling inside a box.
	await expect(config).toContainText("await db.update(books).set({ minutesRead })");
	// typedpress.config.ts, tp/lib/owner.ts, tp/app/shelf.html/route.ts and package.json.
	await expect(page.locator(".explorer-bar")).toContainText("4 you write");
	expect(errors).toEqual([]);
});

test("any file opens, the npm package compiled to PHP and the runtime alike", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("./");
	await pick(page, `${plugins}/typedpress-app-reading-list/tp/app/functions.php`);
	await expect(viewer(page)).toContainText("function escapeHtml(");
	await expect(page).toHaveURL(/#file=tp%2Fdist%2Fwp-content%2Fplugins%2Ftypedpress-app-reading-list%2Ftp%2Fapp%2Ffunctions.php$/);
	// A runtime file, three closed folders down. The tree only renders the rows in view, so it is
	// reached by search, as a visitor would.
	await page.locator(".explorer file-tree-container").click();
	await page.keyboard.type("Db.php");
	await pick(page, `${plugins}/typedpress-runtime/tp/Db.php`);
	await expect(viewer(page)).toContainText("namespace TypedPress;");
	expect(errors).toEqual([]);
});

test("a link to a file opens it, with the folders above it", async ({ page }) => {
	await page.goto(`./examples/pantry#file=${encodeURIComponent(`${plugins}/secure-custom-fields/secure-custom-fields.php`)}`);
	await expect(viewer(page)).toContainText("Plugin Name: Secure Custom Fields");
	await expect(row(page, `${plugins}/secure-custom-fields/secure-custom-fields.php`)).toHaveAttribute("aria-selected", "true");
});

test("every example page has the explorer and its own app plugin", async ({ page }) => {
	for (const [name, app] of [["pantry", "pantry"], ["blog", "blog"], ["full-site", "fullsite"]]) {
		const schema = `${plugins}/typedpress-app-${app}/tp/app/schema.php`;
		await page.goto(`./examples/${name}#file=${encodeURIComponent(schema)}`);
		await expect(page.locator(".explorer-config")).toContainText("defineConfig");
		await pick(page, schema);
		await expect(viewer(page)).toContainText("<?php");
	}
});

test("the explorer follows the site's dark theme", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("./");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	// Polled: the tree and the viewers are custom elements, styled once their scripts have run.
	const scheme = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).colorScheme);
	await expect.poll(() => scheme(".explorer file-tree-container")).toBe("dark");
	await expect.poll(() => scheme(".explorer-config diffs-container")).toBe("dark");
	// The explorer opens the app's functions.php itself. Wait for it, so its selection doesn't
	// replace the one made below.
	await expect(viewer(page)).toContainText("function escapeHtml(");
	await pick(page, `${plugins}/typedpress-app-reading-list/tp/app/schema.php`);
	await expect(viewer(page)).toContainText("<?php");
	await expect.poll(() => scheme(".explorer-loaded diffs-container")).toBe("dark");
});

test("each example has a WordPress Playground blueprint with its own built plugins", async ({ request }) => {
	for (const name of ["reading-list", "pantry", "blog", "full-site"]) {
		const response = await request.get(`./files/${name}.blueprint.json`);
		expect(response.headers()["access-control-allow-origin"]).toBe("*");
		const blueprint = await response.json();
		const installs = blueprint.steps.filter((step: { step: string }) => step.step === "installPlugin").map((step: { pluginData: { url: string } }) => step.pluginData.url);
		const own = installs.filter((url: string) => url.includes(`/files/plugins/${name}/`));
		expect(own.length).toBeGreaterThanOrEqual(3);
		for (const url of own) expect((await request.get(new URL(url).pathname.slice(1))).ok()).toBe(true);
	}
});

test("Run in WordPress embeds Playground with the example's blueprint", async ({ page }) => {
	await page.goto("./examples/pantry");
	await page.locator(".explorer-run").click();
	const frame = page.locator(".explorer-wordpress iframe");
	await expect(frame).toBeVisible();
	await expect(frame).toHaveAttribute("src", /^https:\/\/playground\.wordpress\.net\/\?blueprint-url=.*%2Ffiles%2Fpantry\.blueprint\.json$/);
});
