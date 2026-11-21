// The docs site's parity suite: what the site served before it moved to TypedPress, and what any build
// of it must keep serving. tests/parity/inventory.json is the record (tests/parity/inventory.mjs
// wrote it from that build); each test reads a URL as a reader or an agent would and checks it
// against the record, by role, label and text, never by the markup of one implementation.
//
// It runs against the built site served as static files, as GitHub Pages serves it
// (tests/parity/playwright.config.ts), so the same suite checks a local build and the deployed one
// (PARITY_BASE_URL).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

import { pick } from "../tree.ts";

interface SidebarEntry {
	label: string;
	href: string;
	group: string | null;
}
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
	head: { rel: string; href: string; type: string | null }[];
	social: { title: string | null; card: string | null };
	stops: string[];
}
interface Inventory {
	pages: Record<string, PageRecord>;
	sidebars: Record<string, SidebarEntry[]>;
	redirects: Record<string, { to: string; status: number }>;
	headers: Record<string, string[]>;
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
			// The page's own source file; its extension may change with the source format.
			if (record.edit !== null) await expect(page.getByRole("link", { name: "Edit on GitHub" })).toHaveAttribute("href", new RegExp(`^${escape(record.edit.replace(/\.mdx$/, ""))}\\.mdx?$`));
			for (const link of record.head) {
				const href = await page.locator(`head link[rel="${link.rel}"]${link.type ? `[type="${link.type}"]` : ""}`).evaluateAll((ls) => ls.map((l) => new URL((l as HTMLLinkElement).href).pathname));
				expect(href.map(local), `${route}: <link rel="${link.rel}">`).toContain(link.href);
			}
			if (record.social.title !== null) expect(await meta('meta[property="og:title"]', "content")).toBe(record.social.title);
			if (record.social.card !== null) expect(await meta('meta[name="twitter:card"]', "content")).toBe(record.social.card);
		});
	}
});

test.describe("navigation", () => {
	for (const route of routes) {
		const record = inventory.pages[route]!;
		if (record.tab === null && !record.sidebar && record.toc.length === 0 && record.stops.length === 0 && !record.prev && !record.next) continue;
		test(`${route}: tab, sidebar, table of contents, previous and next`, async ({ page }) => {
			await page.goto(at(route));
			if (record.tab !== null) {
				const tabs = page.getByRole("navigation", { name: "Sections" }).first();
				await expect(tabs.locator('[aria-current="page"]')).toHaveAttribute("href", new RegExp(`${escape(record.tab)}/?$`));
			}
			if (record.sidebar) {
				// The links in the sidebar that are not the section tabs (which a narrow screen repeats there).
				const primary = page.getByRole("complementary", { name: "Primary" });
				const entries = await primary.getByRole("link").evaluateAll((links) =>
					links
						.filter((a) => !a.closest('nav[aria-label="Sections"]'))
						.map((a) => {
							// The group an entry is in: the text heading the list it sits in, if any.
							const list = a.closest("ul")?.parentElement?.closest("li");
							const heading = list?.querySelector(":scope > :first-child")?.textContent?.trim() ?? null;
							return { label: a.textContent!.trim(), href: new URL((a as HTMLAnchorElement).href).pathname, current: a.getAttribute("aria-current") === "page", group: heading };
						}),
				);
				const want = inventory.sidebars[record.tab ?? "/"]!;
				// Every entry it listed, with its label and group, in the same order; a section may gain one.
				const have = entries.map((e) => `${e.group ?? ""} / ${e.label} -> ${local(e.href)}`);
				expect(inOrder(have, want.map((e) => `${e.group ?? ""} / ${e.label} -> ${e.href}`)), `sidebar of ${route}`).toEqual([]);
				expect(entries.filter((e) => e.current).map((e) => local(e.href)), `current entry on ${route}`).toContain(route);
			}
			if (record.toc.length > 0) {
				const toc = page.getByRole("complementary", { name: "On this page" });
				const anchors = await toc.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")).filter((h) => h?.startsWith("#")).map((h) => h!.slice(1)));
				expect(anchors).toEqual(record.toc);
				// Each entry lands on a heading of the page.
				for (const id of record.toc) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
			}
			for (const id of record.stops) await expect(page.locator(`[id="${id}"]`), `${route}#${id}`).toHaveCount(1);
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
		const route = source === "/index.mdx" ? "/" : source.replace(/\.mdx$/, "");
		const h1 = inventory.pages[route]?.h1;
		expect(h1, source).toBeTruthy();
		expect(text.match(/^title: "?(.*?)"?$/m)?.[1], source).toBe(h1);
	}
});

test("every other file the site served is still there", async ({ request }) => {
	for (const file of inventory.files) {
		const response = await request.get(at(file));
		expect(response.ok(), file).toBe(true);
		const body = await response.body();
		if (file.endsWith(".json")) expect(() => JSON.parse(body.toString("utf8")), file).not.toThrow();
		if (file.endsWith(".png")) expect(body.subarray(1, 4).toString("latin1"), file).toBe("PNG");
		if (file.endsWith(".wasm")) expect(body.subarray(0, 4).toString("latin1"), file).toBe("\0asm");
	}
	const robots = await (await request.get(at("/robots.txt"))).text();
	expect(robots).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
});

test("each example's Playground blueprint installs plugins the site serves", async ({ request }) => {
	for (const name of ["reading-list", "pantry", "blog", "full-site"]) {
		const blueprint = await (await request.get(at(`/files/${name}.blueprint.json`))).json();
		const own = blueprint.steps
			.filter((step: { step: string }) => step.step === "installPlugin")
			.map((step: { pluginData: { url: string } }) => new URL(step.pluginData.url).pathname)
			.filter((url: string) => url.includes(`/files/plugins/${name}/`));
		expect(own.length, name).toBeGreaterThanOrEqual(3);
		for (const url of own) expect((await request.get(at(local(url)))).ok(), url).toBe(true);
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
	expect(full).toContain("npm create typedpress my-app");
});

test("files are served with their media types", async ({ request }) => {
	expect((await request.get(at("/getting-started.md"))).headers()["content-type"]).toMatch(/^text\/(markdown|plain)/);
	expect((await request.get(at("/llms.txt"))).headers()["content-type"]).toMatch(/^text\/plain/);
	expect((await request.get(at("/compiler.wasm"))).headers()["content-type"]).toBe("application/wasm");
	expect((await request.get(at("/openapi.json"))).headers()["content-type"]).toMatch(/json/);
});

// What _headers asked of a host that applies it. GitHub Pages ignores _headers, so these hold only
// where the host applies them: PARITY_HEADERS=1 checks them.
test("the _headers rules the site set are kept", async ({ request }) => {
	test.skip(!process.env.PARITY_HEADERS, "the host does not apply _headers (GitHub Pages)");
	const examples: Record<string, string> = { "/*.md": "/getting-started.md", "/*.mdx": "/getting-started.mdx", "/*.txt": "/llms.txt", "/.well-known/agent-skills/*.md": "/.well-known/agent-skills/typedpress/SKILL.md" };
	for (const [pattern, lines] of Object.entries(inventory.headers)) {
		const url = examples[pattern] ?? (pattern.includes("*") ? null : pattern);
		if (url === null) continue;
		const headers = (await request.get(at(url))).headers();
		for (const line of lines) {
			const [name, ...value] = line.split(": ");
			if (name === "X-Powered-By") continue;
			if (name === "Link") for (const part of value.join(": ").split(/,\s*(?=<)/)) expect(headers["link"], url).toContain(part.split(";")[0]);
			else expect(headers[name!.toLowerCase()], `${url}: ${name}`).toBe(value.join(": "));
		}
	}
});

test("an unknown address is a 404 page that leads back to the docs", async ({ page }) => {
	const response = await page.goto(at("/no-such-page"));
	expect(response?.status()).toBe(404);
	await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("Page not found");
	const main = page.getByRole("main");
	await expect(main.getByRole("link").first()).toBeVisible();
	await expect(main.getByRole("link", { name: /home/i }).first()).toHaveAttribute("href", /^(\.?\/|https?:\/\/[^/]+\/?)$/);
});

// --- The site's chrome -------------------------------------------------------------------------

test("the header has the logo, the section tabs, the Tour and GitHub links, and the Playground", async ({ page }) => {
	await page.goto(at("/reference/config"));
	const header = page.getByRole("banner");
	await expect(header.getByRole("link", { name: "TypedPress" }).first()).toHaveAttribute("href", /\/$/);
	const tabs = header.getByRole("navigation", { name: "Sections" }).first();
	await expect(tabs.getByRole("link")).toHaveText(["Docs", "Examples", "Reference", "REST API"]);
	await expect(header.getByRole("link", { name: "Tour", exact: true })).toHaveAttribute("href", /\/tour$/);
	await expect(header.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute("href", "https://github.com/spacefast/zero");
	await expect(header.getByRole("link", { name: "Playground", exact: true })).toHaveAttribute("href", /\/playground$/);
});

test("the footer has the licence line and the Spacefast link", async ({ page }) => {
	await page.goto(at("/getting-started"));
	const footer = page.getByRole("contentinfo");
	await expect(footer).toContainText("TypedPress is MIT licensed. The code that runs inside WordPress is GPL-2.0-or-later.");
	await expect(footer.getByRole("link", { name: "Spacefast" })).toHaveAttribute("href", "https://spacefast.com");
});

test("the theme follows the system and the toggle switches it and remembers it", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto(at("/getting-started"));
	// Read by what a reader sees: how light the page background is.
	const lightness = () => page.locator("body").evaluate((b) => {
		// Any CSS colour (rgb, oklch, …) to sRGB, through a canvas.
		const canvas = document.createElement("canvas").getContext("2d")!;
		canvas.fillStyle = getComputedStyle(b).backgroundColor;
		canvas.fillRect(0, 0, 1, 1);
		const [r, g, bl] = canvas.getImageData(0, 0, 1, 1).data;
		return (r! + g! + bl!) / 3;
	});
	await expect.poll(lightness).toBeLessThan(80);
	await page.getByRole("button", { name: "Toggle theme" }).click();
	await expect.poll(lightness).toBeGreaterThan(175);
	await page.reload();
	await expect.poll(lightness).toBeGreaterThan(175);
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
	await expect(block).toContainText("npm create typedpress");
	await page.getByRole("button", { name: "Copy code" }).first().click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("npm create typedpress");
});

test("code is highlighted, in the light and the dark theme", async ({ page }) => {
	await page.goto(at("/getting-started"));
	const colors = () => page.locator("main pre").first().locator("span").evaluateAll((spans) => [...new Set(spans.map((s) => getComputedStyle(s).color))]);
	const light = await colors();
	expect(light.length).toBeGreaterThan(2);
	await page.getByRole("button", { name: "Toggle theme" }).click();
	await expect.poll(colors).not.toEqual(light);
});

// --- Content components ----------------------------------------------------------------------

test("a note callout renders as an aside in the text", async ({ page }) => {
	await page.goto(at("/getting-started"));
	const note = page.getByRole("main").getByText("are not published yet");
	await expect(note).toBeVisible();
	// Set apart from the text: inside an aside or a note, not an ordinary paragraph.
	expect(await note.evaluate((el) => !!el.closest('aside, [role="note"]'))).toBe(true);
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
	await expect(page.getByRole("heading", { name: /^A layout/ })).toBeVisible();
	// tests/fixtures/app-router/tp/app/layout.tsx, which only this file says.
	const file = page.getByRole("main").getByText("%s · Field Notes").first();
	await expect(file).toBeVisible();
	await expect(page.getByRole("main").getByText("layout.tsx", { exact: true }).first()).toBeVisible();
	const colours = await file.evaluate((el) => {
		let block: Element | null = el;
		while (block && !/^(pre|code)$/i.test(block.tagName) && !(block.parentNode instanceof ShadowRoot)) block = block.parentElement;
		const root = (block?.parentNode instanceof ShadowRoot ? block.parentNode : block) ?? el;
		return new Set([...root.querySelectorAll("span")].map((s) => getComputedStyle(s).color)).size;
	});
	expect(colours).toBeGreaterThan(2);
});

test("CompiledExcerpt shows the PHP the compiler wrote for an example", async ({ page }) => {
	await page.goto(at("/compiler"));
	for (const fn of ["function signed_in(", "function reads__before_create(", "function job__tally(", "function ms("]) {
		await expect(page.locator("main").getByText(fn, { exact: false }).first()).toBeVisible();
	}
});

test("ExampleConfig shows an example's config with the compiler's names", async ({ page }) => {
	await page.goto(at("/reference/wordpress-plugins"));
	// examples/wp-plugins/typedpress.config.ts, shown with TypedPress's names.
	await expect(page.getByRole("main").getByText('"classic-editor": "1.6.7"').first()).toBeVisible();
	await expect(page.getByRole("main").getByText('from "typedpress"').first()).toBeVisible();
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

	test("an operation has request samples in cURL and JavaScript, one shown at a time", async ({ page }) => {
		await page.goto(at("/rest/posts/posts-list"));
		const main = page.locator("main");
		const curl = main.getByText(/curl -X GET/).first();
		const js = main.getByText(/await fetch\(/).first();
		await expect(curl).toBeVisible();
		await expect(js).toBeHidden();
		await main.getByText("JavaScript", { exact: true }).first().click();
		await expect(js).toBeVisible();
		await expect(curl).toBeHidden();
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
	const status = page.getByRole("status");
	await expect(status).toHaveText(/^Compiled reading-list\. \d+ generated files\.$/, { timeout: 30_000 });
	await expect(page.getByRole("combobox", { name: "Example", exact: true })).toHaveValue("reading-list");
	await expect(page.getByRole("textbox", { name: "Generated code", exact: true })).not.toHaveValue("");
	// An edit recompiles; a config that doesn't compile shows the compiler's diagnostics.
	const source = page.getByRole("textbox", { name: "Source code", exact: true });
	await source.fill("export const =");
	await expect(status).toHaveText("Fix the config to generate files.");
	await expect(page.getByRole("alert")).not.toBeEmpty();
	await page.getByRole("button", { name: "Reset example" }).click();
	await expect(status).toHaveText(/^Compiled reading-list\./);
	await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("blog");
	await expect(status).toHaveText(/^Compiled blog\./);
	expect(errors).toEqual([]);
});

test("the tour shows each stop's config next to what it compiles to", async ({ page }) => {
	await page.goto(at("/tour"));
	await expect(page.getByRole("link", { name: /^The pantry/ })).toHaveAttribute("href", /\/tour\/pantry$/);
	await page.goto(at("/tour/pantry#a-hook"));
	const stop = page.locator(":target");
	await expect(stop).toContainText("beforeCreate(data)");
	await expect(stop).toContainText("function items__before_create");
});

test("an example page lists every file, opens one, and opens one a link names", async ({ page }) => {
	const plugins = "tp/dist/wp-content/plugins";
	const file = `${plugins}/typedpress-app-pantry/tp/app/schema.php`;
	await page.goto(at(`/examples/pantry#file=${encodeURIComponent(file)}`));
	await expect(page.getByRole("main").getByText("<?php").first()).toBeVisible();
	await page.goto(at("/examples/pantry"));
	const tree = page.getByRole("tree").first();
	await expect(tree).toBeVisible();
	// The tree opens on the app plugin's folder and the explorer opens its compiled PHP. Wait for that
	// file, so its selection doesn't replace the one made here; then a click shows the file.
	await expect(page.getByRole("main").getByText("<?php").first()).toBeVisible();
	await pick(page, file);
	await expect(tree.getByRole("treeitem", { name: "schema.php", exact: true }).first()).toHaveAttribute("aria-selected", "true");
	await expect(page).toHaveURL(/#file=.*schema\.php$/);
	await expect(page.getByRole("main").getByText("'name' => 'pantry'", { exact: false }).first()).toBeVisible();
});

test("an example page runs it in WordPress Playground", async ({ page }) => {
	await page.goto(at("/examples/pantry"));
	await expect(page.locator("main").getByText("defineConfig", { exact: false }).first()).toBeVisible();
	await page.getByRole("button", { name: /Run in WordPress/ }).first().click();
	await expect(page.locator("main iframe").first()).toHaveAttribute("src", /^https:\/\/playground\.wordpress\.net\/\?blueprint-url=.*%2Ffiles%2Fpantry\.blueprint\.json$/);
});

/** The entries of `want` that `have` lacks or lists out of order. */
function inOrder(have: string[], want: string[]): string[] {
	let at = 0;
	const missing: string[] = [];
	for (const entry of want) {
		const found = have.indexOf(entry, at);
		if (found < 0) missing.push(entry);
		else at = found + 1;
	}
	return missing;
}

/** A path without a trailing slash. */
function local(path: string): string {
	return path.length > 1 ? path.replace(/\/$/, "") : path;
}

/**
 * Where an address that moved leads: an HTTP redirect where the host has them, or a page whose
 * refresh points on, where it serves static files only (GitHub Pages).
 */
async function destination(request: APIRequestContext, from: string): Promise<string> {
	let url = at(from);
	let response = await request.get(url, { maxRedirects: 0 });
	// A host that adds a trailing slash to a directory first (GitHub Pages) is not the move itself.
	for (let hop = 0; hop < 3; hop++) {
		const location = response.headers()["location"];
		if (response.status() < 300 || response.status() >= 400 || !location) break;
		const next = new URL(location, response.url());
		if (local(next.pathname) !== local(new URL(response.url()).pathname)) return local(next.pathname);
		url = next.href;
		response = await request.get(url, { maxRedirects: 0 });
	}
	expect(response.status(), from).toBe(200);
	const refresh = (await response.text()).match(/<meta http-equiv="refresh" content="0;\s*url=([^"]+)"/i)?.[1];
	expect(refresh, `${from} neither redirects nor refreshes`).toBeTruthy();
	return local(new URL(refresh!, response.url()).pathname);
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
