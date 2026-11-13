// The docs site's parity suite: what the site served before it moved to First, and what any build
// of it must keep serving. tests/parity/inventory.json is the record (tests/parity/inventory.mjs
// wrote it from that build); each test reads a URL as a reader or an agent would and checks it
// against the record, by role, label and text, never by the markup of one implementation.
//
// It runs against the built site served as static files, as GitHub Pages serves it
// (tests/parity/playwright.config.ts), so the same suite checks a local build and the deployed one
// (PARITY_BASE_URL).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

interface PageRecord {
	title: string;
	h1: string;
	description: string | null;
	canonical: string | null;
	markdown: string | null;
	ogImage: string | null;
	tab: string | null;
	edit: string | null;
	toc: string[];
	prev: string | null;
	next: string | null;
	sidebar?: true;
	operation?: string | null;
}
interface Inventory {
	pages: Record<string, PageRecord>;
	sidebars: Record<string, string[]>;
	redirects: Record<string, { to: string; status: number }>;
	markdown: string[];
	mdx: string[];
	files: string[];
	sitemap: string[];
	llms: string[];
}

const inventory: Inventory = JSON.parse(readFileSync(new URL("./inventory.json", import.meta.url), "utf8"));
const routes = Object.keys(inventory.pages);
const at = (path: string) => `.${path}`;
const here = (page: Page) => local(new URL(page.url()).pathname);

// --- Every URL --------------------------------------------------------------------------------

test.describe("every page", () => {
	for (const route of routes) {
		const record = inventory.pages[route]!;
		test(`${route} has its title, heading, description and links`, async ({ page }) => {
			const response = await page.goto(at(route));
			expect(response?.status(), "status").toBe(200);
			await expect(page).toHaveTitle(record.title);
			await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(record.h1);
			const meta = (selector: string, name: string) => page.locator(selector).first().getAttribute(name);
			const description = await meta('meta[name="description"]', "content");
			// An operation's description is cut from the OpenAPI document; it names the operation.
			if (record.operation) expect(description).toContain(record.operation);
			else if (record.description !== null) expect(description).toBe(record.description);
			if (record.canonical !== null) expect(new URL((await meta('link[rel="canonical"]', "href"))!, page.url()).pathname).toMatch(new RegExp(`${escape(record.canonical)}/?$`));
			if (record.markdown !== null) expect(await meta('link[rel="alternate"][type="text/markdown"]', "href")).toMatch(new RegExp(`${escape(record.markdown)}$`));
			if (record.ogImage !== null) {
				const image = await meta('meta[property="og:image"]', "content");
				expect(new URL(image!).pathname).toMatch(new RegExp(`${escape(record.ogImage)}$`));
			}
			if (record.edit !== null) await expect(page.getByRole("link", { name: "Edit on GitHub" })).toHaveAttribute("href", /^https:\/\/github\.com\/spacefast\/zero\/edit\/main\/docs-site\//);
		});
	}
});

test.describe("navigation", () => {
	for (const route of routes) {
		const record = inventory.pages[route]!;
		if (record.tab === null && !record.sidebar && record.toc.length === 0 && !record.prev && !record.next) continue;
		test(`${route}: tab, sidebar, table of contents, previous and next`, async ({ page }) => {
			await page.goto(at(route));
			if (record.tab !== null) {
				const tabs = page.getByRole("navigation", { name: "Sections" }).first();
				await expect(tabs.locator('[aria-current="page"]')).toHaveAttribute("href", new RegExp(`${escape(record.tab)}/?$`));
			}
			if (record.sidebar) {
				const sidebar = page.getByRole("complementary", { name: "Primary" }).getByRole("navigation").last();
				const hrefs = await sidebar.getByRole("link").evaluateAll((links) => links.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
				expect([...new Set(hrefs.map(local))]).toEqual(inventory.sidebars[record.tab ?? "/"]);
				await expect(sidebar.locator('[aria-current="page"]')).toHaveAttribute("href", new RegExp(`${escape(route)}/?$`));
			}
			if (record.toc.length > 0) {
				const toc = page.getByRole("complementary", { name: "On this page" });
				const anchors = await toc.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")).filter((h) => h?.startsWith("#")).map((h) => h!.slice(1)));
				expect(anchors).toEqual(record.toc);
				// Each entry lands on a heading of the page.
				for (const id of record.toc) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
			}
			const pager = page.getByRole("navigation", { name: "Pagination" });
			for (const [rel, want] of [["prev", record.prev], ["next", record.next]] as const) {
				const link = pager.getByRole("link", { name: rel === "prev" ? /^Previous/ : /^Next/ });
				if (want === null) await expect(link).toHaveCount(0);
				else await expect(link).toHaveAttribute("href", new RegExp(`${escape(want)}/?$`));
			}
		});
	}
});

test.describe("addresses that moved", () => {
	for (const [from, { to }] of Object.entries(inventory.redirects)) {
		test(`${from} leads to ${to}`, async ({ request }) => {
			expect(await destination(request, from)).toBe(to);
		});
	}
});

test("every page has its Markdown twin, the same text a reader sees", async ({ request }) => {
	for (const twin of inventory.markdown) {
		const response = await request.get(at(twin));
		expect(response.ok(), twin).toBe(true);
		const body = await response.text();
		expect(body.length, twin).toBeGreaterThan(40);
		expect(body.trimStart().startsWith("<"), `${twin} is Markdown, not a page`).toBe(false);
	}
	for (const [route, record] of Object.entries(inventory.pages)) {
		if (record.markdown === null) continue;
		expect(await (await request.get(at(record.markdown))).text(), route).toContain(record.h1);
	}
});

test("every .mdx address still answers with the page's source", async ({ request }) => {
	for (const source of inventory.mdx) {
		const response = await request.get(at(source));
		expect(response.ok(), source).toBe(true);
		// The page's own source: front matter and the same title as its Markdown twin.
		const text = await response.text();
		expect(text.startsWith("---\n"), source).toBe(true);
		const title = (await (await request.get(at(source.replace(/\.mdx$/, ".md")))).text()).match(/^title: (.*)$/m)?.[1];
		expect(text, source).toContain(`title: ${title}`);
	}
});

test("every other file the site served is still there", async ({ request }) => {
	for (const file of inventory.files) {
		const response = await request.get(at(file));
		expect(response.ok(), file).toBe(true);
	}
});

test("the sitemap lists every page it listed", async ({ request }) => {
	const xml = await (await request.get(at("/sitemap.xml"))).text();
	const listed = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => local(new URL(m[1]!).pathname));
	for (const route of inventory.sitemap) expect(listed, route).toContain(route);
});

test("llms.txt lists every page it listed, and llms-full.txt has their text", async ({ request }) => {
	const llms = await (await request.get(at("/llms.txt"))).text();
	const listed = [...llms.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => local(new URL(m[1]!).pathname));
	for (const route of inventory.llms) expect(listed, route).toContain(route);
	const full = await (await request.get(at("/llms-full.txt"))).text();
	for (const route of ["/getting-started", "/reference/config", "/publishing/spacefast"]) expect(full).toContain(inventory.pages[route]!.h1);
	expect(full).toContain("npm create @spacefast/first my-app");
});

test("Markdown and text files are served with their media types", async ({ request }) => {
	expect((await request.get(at("/getting-started.md"))).headers()["content-type"]).toMatch(/^text\/(markdown|plain)/);
	expect((await request.get(at("/llms.txt"))).headers()["content-type"]).toMatch(/^text\/plain/);
	expect((await request.get(at("/compiler.wasm"))).headers()["content-type"]).toBe("application/wasm");
	expect((await request.get(at("/openapi.json"))).headers()["content-type"]).toMatch(/json/);
});

test("an unknown address is a 404 page that leads back to the docs", async ({ page }) => {
	const response = await page.goto(at("/no-such-page"));
	expect(response?.status()).toBe(404);
	await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("Page not found");
	await expect(page.getByRole("link", { name: "Docs", exact: true }).first()).toBeVisible();
});

// --- The site's chrome -------------------------------------------------------------------------

test("the header has the logo, the section tabs, the Tour and GitHub links, and the Playground", async ({ page }) => {
	await page.goto(at("/reference/config"));
	const header = page.getByRole("banner");
	await expect(header.getByRole("link", { name: "First" }).first()).toHaveAttribute("href", /\/$/);
	const tabs = header.getByRole("navigation", { name: "Sections" }).first();
	await expect(tabs.getByRole("link")).toHaveText(["Docs", "Examples", "Reference", "REST API"]);
	await expect(header.getByRole("link", { name: "Tour", exact: true })).toHaveAttribute("href", /\/tour$/);
	await expect(header.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute("href", "https://github.com/spacefast/zero");
	await expect(header.getByRole("link", { name: "Playground", exact: true })).toHaveAttribute("href", /\/playground$/);
});

test("the footer has the licence line and the Spacefast link", async ({ page }) => {
	await page.goto(at("/getting-started"));
	const footer = page.getByRole("contentinfo");
	await expect(footer).toContainText("First is MIT licensed. The code that runs inside WordPress is GPL-2.0-or-later.");
	await expect(footer.getByRole("link", { name: "Spacefast" })).toHaveAttribute("href", "https://spacefast.com");
});

test("the theme follows the system and the toggle switches it and remembers it", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto(at("/getting-started"));
	const theme = () => page.locator("html").getAttribute("data-theme");
	expect(await theme()).toBe("dark");
	const background = () => page.locator("body").evaluate((b) => getComputedStyle(b).backgroundColor);
	const dark = await background();
	await page.getByRole("button", { name: "Toggle theme" }).click();
	expect(await theme()).toBe("light");
	expect(await background()).not.toBe(dark);
	await page.reload();
	expect(await theme()).toBe("light");
});

test("search finds a page by a word in its text and opens it", async ({ page }) => {
	await page.goto(at("/getting-started"));
	await page.getByRole("button", { name: "Search" }).click();
	await page.getByRole("combobox", { name: "Search docs" }).fill("sitemap");
	const result = page.getByRole("option").filter({ hasText: "Pages in TSX and the Interactivity API" }).first();
	await expect(result).toBeVisible();
	await result.click();
	await expect.poll(() => here(page)).toBe("/pages");
});

test("on a narrow screen the sidebar opens from the menu button", async ({ browser }) => {
	const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
	await page.goto(at("/reference/config"));
	const cli = page.getByRole("complementary", { name: "Primary" }).getByRole("link", { name: "CLI", exact: true });
	await expect(cli).not.toBeInViewport();
	await page.getByRole("button", { name: "Toggle navigation" }).click();
	await expect(cli).toBeInViewport();
	await page.close();
});

test("a code block has a copy button", async ({ page, context }) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(at("/getting-started"));
	const block = page.locator("main pre").first();
	await expect(block).toContainText("npm create @spacefast/first");
	await page.getByRole("button", { name: "Copy code" }).first().click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("npm create @spacefast/first");
});

test("code is highlighted, in the light and the dark theme", async ({ page }) => {
	await page.goto(at("/getting-started"));
	const colors = () => page.locator("main pre").first().locator("span").evaluateAll((spans) => [...new Set(spans.map((s) => getComputedStyle(s).color))]);
	const light = await colors();
	expect(light.length).toBeGreaterThan(2);
	await page.getByRole("button", { name: "Toggle theme" }).click();
	const dark = await colors();
	expect(dark).not.toEqual(light);
});

// --- Content components ----------------------------------------------------------------------

test("a note callout renders as an aside in the text", async ({ page }) => {
	await page.goto(at("/getting-started"));
	await expect(page.locator("main aside").filter({ hasText: "are not published yet" })).toBeVisible();
});

test("cards link to their pages, with a title and a line of text", async ({ page }) => {
	await page.goto(at("/"));
	const cards = page.locator("main").getByRole("link").filter({ hasText: "Create an app, run it on your machine" });
	await expect(cards).toHaveAttribute("href", /\/getting-started$/);
	await expect(cards).toContainText("Get started");
	await page.goto(at("/reference"));
	for (const [title, href] of [["Config API", "/reference/config"], ["REST API", "/rest"], ["JavaScript client", "/reference/client"]] as const) {
		await expect(page.locator("main").getByRole("link").filter({ hasText: title }).first()).toHaveAttribute("href", new RegExp(`${escape(href)}$`));
	}
});

test("RepoFile shows a repository file whole, highlighted", async ({ page }) => {
	await page.goto(at("/pages"));
	const heading = page.getByRole("heading", { name: /^A layout/ });
	await expect(heading).toBeVisible();
	const file = page.locator("main").getByText("export const metadata", { exact: false }).first();
	await expect(file).toBeVisible();
});

test("CompiledExcerpt shows the PHP the compiler wrote for an example", async ({ page }) => {
	await page.goto(at("/compiler"));
	for (const fn of ["function signedIn(", "function reads__beforeCreate(", "function job__tally(", "function ms("]) {
		await expect(page.locator("main").getByText(fn, { exact: false }).first()).toBeVisible();
	}
});

test("ExampleConfig shows an example's config with the compiler's names", async ({ page }) => {
	await page.goto(at("/reference/wordpress-plugins"));
	await expect(page.locator("main").getByText("defineConfig", { exact: false }).first()).toBeVisible();
});

test("PagesArtifact shows what first-pages build wrote", async ({ page }) => {
	await page.goto(at("/pages"));
	await expect(page.locator("main").getByText("note page template", { exact: false }).first()).toBeVisible();
	await expect(page.locator("main").getByText("island bundle", { exact: false }).first()).toBeVisible();
});

// --- The REST reference ---------------------------------------------------------------------

test.describe("the REST reference", () => {
	const operations = routes.filter((r) => inventory.pages[r]!.operation);
	test("each operation page names its method and path", async ({ page }) => {
		for (const route of operations) {
			await page.goto(at(route));
			const [method, path] = inventory.pages[route]!.operation!.split(" ") as [string, string];
			const main = page.locator("main");
			await expect(main.getByText(method, { exact: true }).first(), route).toBeVisible();
			await expect(main.getByText(path, { exact: true }).first(), route).toBeVisible();
		}
	});

	test("an operation has request samples in cURL and JavaScript", async ({ page }) => {
		await page.goto(at("/rest/posts/posts-list"));
		const tabs = page.getByRole("tablist", { name: "Request" });
		await expect(tabs.getByRole("tab", { name: "cURL" })).toHaveAttribute("aria-selected", "true");
		await expect(page.getByRole("tabpanel").filter({ visible: true }).first()).toContainText("curl -X GET");
		await tabs.getByRole("tab", { name: "JavaScript" }).click();
		await expect(page.getByRole("tabpanel").filter({ visible: true }).first()).toContainText("await fetch(");
	});

	test("an operation lists its parameters and responses", async ({ page }) => {
		await page.goto(at("/rest/posts/posts-list"));
		const main = page.locator("main");
		for (const name of ["where", "orderBy", "limit", "cursor", "search"]) await expect(main.getByText(name, { exact: true }).first()).toBeVisible();
		await expect(main.getByText("One page of rows.").first()).toBeVisible();
	});
});

// --- Playground and tour -------------------------------------------------------------------

test("the playground compiles the default example in the browser", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(at("/playground"));
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Playground");
	await expect(page.locator("#compile-status")).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
	await expect(page.getByRole("combobox", { name: "Example", exact: true })).toHaveValue("reading-list");
	await expect(page.getByRole("textbox", { name: "Generated code", exact: true })).not.toHaveValue("");
	expect(errors).toEqual([]);
});

test("the tour shows each stop's config next to what it compiles to", async ({ page }) => {
	await page.goto(at("/tour"));
	await expect(page.getByRole("link", { name: /^The pantry/ })).toHaveAttribute("href", /\/tour\/pantry$/);
	await page.goto(at("/tour/pantry#a-hook"));
	const stop = page.locator("#a-hook");
	await expect(stop).toContainText("beforeCreate(data)");
	await expect(stop).toContainText("function items__beforeCreate");
});

test("an example page opens its files and runs it in WordPress Playground", async ({ page }) => {
	await page.goto(at("/examples/pantry"));
	await expect(page.locator("main").getByText("defineConfig", { exact: false }).first()).toBeVisible();
	await page.getByRole("button", { name: /Run in WordPress/ }).first().click();
	await expect(page.locator("main iframe").first()).toHaveAttribute("src", /^https:\/\/playground\.wordpress\.net\/\?blueprint-url=.*%2Ffiles%2Fpantry\.blueprint\.json$/);
});

/** A path without a trailing slash. */
function local(path: string): string {
	return path.length > 1 ? path.replace(/\/$/, "") : path;
}

/**
 * Where an address that moved leads: an HTTP redirect where the host has them, or a page whose
 * refresh points on, where it serves static files only (GitHub Pages).
 */
async function destination(request: APIRequestContext, from: string): Promise<string> {
	const response = await request.get(at(from), { maxRedirects: 0 });
	const location = response.headers()["location"];
	if (response.status() >= 300 && response.status() < 400 && location) return local(new URL(location, response.url()).pathname);
	expect(response.status(), from).toBe(200);
	const refresh = (await response.text()).match(/<meta http-equiv="refresh" content="0;\s*url=([^"]+)"/i)?.[1];
	expect(refresh, `${from} neither redirects nor refreshes`).toBeTruthy();
	return local(new URL(refresh!, response.url()).pathname);
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
