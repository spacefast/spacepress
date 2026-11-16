import { test, expect } from "@playwright/test";

test("the landing page links to the guide, the playground and the examples", async ({ page }) => {
	await page.goto("./");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("TypedPress");
	await expect(page.getByRole("link", { name: /Get started/ }).first()).toHaveAttribute("href", "/getting-started");
	await expect(page.getByRole("link", { name: /Playground/ }).first()).toHaveAttribute("href", "/playground");
});

test("the examples index lists only the site's examples", async ({ page }) => {
	await page.goto("./examples");
	const links = page.locator("main table").getByRole("link");
	await expect(links).toHaveText(["Reading list", "Pantry", "Blog", "Full site"]);
});

test("the pages of examples the site no longer features redirect to the examples index", async ({ page }) => {
	for (const name of ["kitchen-sink", "recipes", "wp-plugins"]) {
		await page.goto(`./examples/${name}`);
		await expect(page).toHaveURL(/\/examples\/?$/);
	}
});

test("the plugin list names every plugin typedpress build installs", async ({ page }) => {
	await page.goto("./reference/wordpress-plugins");
	for (const slug of ["secure-custom-fields", "action-scheduler", "mcp-adapter"]) {
		await expect(page.getByRole("row").filter({ hasText: slug }).filter({ hasText: "Always installed" })).toHaveCount(1);
	}
});

test("the REST reference has a page per operation", async ({ page }) => {
	await page.goto("./rest");
	// The reference is the blog example's own document, so its operations are named after its kinds.
	await expect(page.getByRole("link", { name: "List posts" }).first()).toBeVisible();
});

test("agents can read the docs as Markdown", async ({ request }) => {
	const llms = await request.get("./llms.txt");
	expect(llms.ok()).toBe(true);
	expect(await llms.text()).toContain("/getting-started");
	const markdown = await request.get("./getting-started.md");
	expect(markdown.ok()).toBe(true);
	expect(await markdown.text()).toContain("npm create typedpress my-app");
});
