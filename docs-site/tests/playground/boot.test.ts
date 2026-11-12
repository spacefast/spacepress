// Boots every site example in WordPress Playground from the blueprint the site publishes
// (public/files/<name>.blueprint.json, written by scripts/build-showcase.ts), and checks the app
// works there: First's plugins are active, each collection answers on the REST API, each
// collection stored as WordPress posts has its wp-admin list and editor, and the example's landing
// page opens. This is the WordPress a visitor gets from "Run in WordPress".
//
// The blueprint names the site's published address for First's plugin zips. Here they are served
// from public/files/ on a local port instead; everything else (WordPress, PHP, the WordPress.org
// plugins) is fetched as it is for a visitor. Run `pnpm showcase` first.
import { runCLI, type RunCLIServer } from "@wp-playground/cli";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { siteExamples } from "../../lib/site-examples.ts";
import { site } from "../unit/helpers.ts";
import { browser, serveFiles } from "./helpers.ts";

const files = path.join(site, "public/files");

// What the app plugin declares, read inside WordPress from the schema `first build` wrote.
const describeApp = (app: string) => `<?php
require_once '/wordpress/wp-load.php';
$schema = require WP_PLUGIN_DIR . '/first-app-${app}/first/app/schema.php';
$collections = [];
foreach ($schema['collections'] as $key => $collection) {
	$collections[] = ['key' => $key, 'postType' => $collection['wp']['postType'] ?? null];
}
echo wp_json_encode(['active' => get_option('active_plugins'), 'collections' => $collections]);
`;

// Each collection's list route, as the admin, through First's API (in process, as an HTTP request would).
const restStatus = (keys: string[]) => `<?php
require_once '/wordpress/wp-load.php';
wp_set_current_user(1);
$out = [];
foreach (json_decode(base64_decode('${Buffer.from(JSON.stringify(keys)).toString("base64")}'), true) as $key) {
	$out[$key] = \\First\\Wp\\Facade::route(\\First\\Wp\\Runtime::plugin(), 'GET', '/' . $key, [], '')[0];
}
echo wp_json_encode($out);
`;

type Browser = ReturnType<typeof browser>;

/**
 * A REST call as `as` makes it. WordPress reads a cookie as signed out on the REST API unless the
 * request carries the REST nonce, which the block editor prints for the signed-in admin.
 */
async function rest(as: Browser, route: string, init: { method?: string; body?: unknown } = {}, nonce?: string) {
	const response = await as(route, {
		method: init.method,
		headers: { ...(nonce ? { "x-wp-nonce": nonce } : {}), ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
	assert.equal(response.status, 200, `${route}: ${response.body.slice(0, 300)}`);
	return JSON.parse(response.body) as { data: Record<string, unknown>[] };
}

async function adminNonce(admin: Browser): Promise<string> {
	const editor = await admin("/wp-admin/post-new.php");
	const nonce = /createNonceMiddleware\(\s*"([0-9a-f]+)"/.exec(editor.body)?.[1];
	assert.ok(nonce, "the block editor printed no REST nonce");
	return nonce;
}

// What each example's sample data shows: the seed ran, and its hooks and jobs did their work.
const exampleChecks: Record<string, { title: string; run: (base: string, admin: Browser) => Promise<void> }> = {
	"reading-list": {
		title: "the tally jobs filled in minutes read, the draft is the admin's only, and the shelf route lists the books",
		async run(base, admin) {
			const visitor = browser(base, { signedOut: true });
			const books = (await rest(visitor, "/__first/api/v1/books")).data;
			assert.deepEqual(books.map((b) => [b.title, b.minutesRead]).sort(), [["A Wizard of Earthsea", 45], ["The Dispossessed", 65], ["The Left Hand of Darkness", 25]]);
			const all = (await rest(admin, "/__first/api/v1/books?status=draft", {}, await adminNonce(admin))).data;
			assert.deepEqual(all.map((b) => b.title), ["The Lathe of Heaven"]);
			const shelf = await visitor("/shelf.html");
			assert.equal(shelf.status, 200);
			assert.match(shelf.body, /<li>The Dispossessed: 1 hour<\/li>/);
		},
	},
	pantry: {
		title: "milk is on the shopping list and notified, and milk and butter expire soon",
		async run(_base, admin) {
			const nonce = await adminNonce(admin);
			const list = (await rest(admin, "/__first/api/v1/shopping_list", {}, nonce)).data;
			assert.deepEqual(list.map((row) => row.name), ["Milk"]);
			assert.ok(list[0]!.notifiedAt, "the notifyLowStock job did not run");
			const soon = (await rest(admin, "/__first/api/v1/actions/expiringSoon", { method: "POST", body: {} }, nonce)).data;
			assert.deepEqual(soon.map((item) => [item.name, item.where]), [["Butter", "Fridge"], ["Milk", "Fridge"]]);
		},
	},
	blog: {
		title: "/__first/api/v1/posts lists the published posts, and a reader's comment waits for an editor",
		async run(base, admin) {
			const visitor = browser(base, { signedOut: true });
			const published = (await rest(visitor, "/__first/api/v1/posts")).data;
			assert.deepEqual(published.map((p) => p.title).sort(), ["Comments are moderated", "Hello, First"]);
			const nonce = await adminNonce(admin);
			const drafts = (await rest(admin, "/__first/api/v1/posts?status=draft", {}, nonce)).data;
			assert.deepEqual(drafts.map((p) => p.title), ["Typed content, plain files"]);
			const shown = (await rest(visitor, "/__first/api/v1/comments")).data;
			assert.equal(shown.length, 2, "a signed-out reader should see the two approved comments");
			const waiting = (await rest(admin, "/__first/api/v1/comments", {}, nonce)).data.filter((c) => c.approved === false);
			assert.equal(waiting.length, 1);
			assert.ok(waiting[0]!.notifiedAt, "the notifyEditors job did not stamp the reader's comment");
		},
	},
	"full-site": {
		title: "a signed-out visitor reads the TSX pages: /notes/, and a note with its cheer island and no desk notes",
		async run(base) {
			const visitor = browser(base, { signedOut: true });
			const list = await visitor("/notes/");
			assert.equal(list.status, 200);
			assert.match(list.body, /<a href="[^"]*\/notes\/dawn-on-the-ridge\/">Dawn on the ridge<\/a>/);
			assert.doesNotMatch(list.body, /Notes for next week/, "a draft is listed to a signed-out visitor");
			const note = await visitor("/notes/dawn-on-the-ridge/");
			assert.equal(note.status, 200);
			assert.match(note.body, /<h1[^>]*>Dawn on the ridge<\/h1>/);
			assert.match(note.body, /data-wp-interactive="fullsite\/cheer"/);
			assert.match(note.body, /data-wp-text="context.count"[^>]*>3</);
			assert.doesNotMatch(note.body, /Check the photo credit/, "desk notes shown to a signed-out visitor");
		},
	},
};

let zips: http.Server;
before(async () => {
	zips = await serveFiles();
});
after(() => zips.close());

for (const example of siteExamples) {
	describe(`examples/${example.name} in WordPress Playground`, () => {
		let wordpress: RunCLIServer;
		let get: ReturnType<typeof browser>;
		let app: string;
		let installed: string[];

		before(async () => {
			const blueprintFile = path.join(files, `${example.name}.blueprint.json`);
			if (!existsSync(blueprintFile)) throw new Error(`${blueprintFile} is missing; run pnpm showcase`);
			const { port } = zips.address() as AddressInfo;
			// First's zips from the local server; every other URL as published.
			const blueprint = JSON.parse(readFileSync(blueprintFile, "utf8").replace(/"https?:\/\/[^"]+?\/files\/plugins\//g, `"http://127.0.0.1:${port}/files/plugins/`));
			// The plugin folder each installPlugin step unpacks: the zip's name without its version.
			installed = (blueprint.steps as { step: string; pluginData?: { url: string } }[])
				.filter((step) => step.step === "installPlugin")
				.map((step) => path.basename(new URL(step.pluginData!.url).pathname, ".zip").replace(/\.\d[\w.-]*$/, ""));
			app = (JSON.parse(readFileSync(path.join(files, `${example.name}.json`), "utf8")) as { app: string }).app;
			// WordPress, PHP and the WordPress.org plugins come over the network. A download that fails
			// is retried once; any other failure is the example's.
			const boot = () => runCLI({ command: "server", port: 0, blueprint, verbosity: "quiet" });
			wordpress = await boot().catch((error: Error) => {
				if (!/Could not download/.test(String(error?.message))) throw error;
				return boot();
			});
			get = browser(wordpress.serverUrl);
		});
		after(async () => {
			await wordpress?.[Symbol.asyncDispose]();
		});

		test("First's plugins are active, and every collection answers on the REST API", async () => {
			const described = JSON.parse((await wordpress.playground.run({ code: describeApp(app) })).text) as { active: string[]; collections: { key: string; postType: string | null }[] };
			// Every plugin the blueprint installs, First's and WordPress.org's, is active.
			for (const plugin of installed) {
				assert.ok(described.active.some((file) => file.startsWith(`${plugin}/`)), `${plugin} is not active: ${described.active.join(", ")}`);
			}
			assert.ok(described.collections.length > 0);
			const statuses = JSON.parse((await wordpress.playground.run({ code: restStatus(described.collections.map((c) => c.key)) })).text) as Record<string, number>;
			assert.deepEqual(statuses, Object.fromEntries(described.collections.map((c) => [c.key, 200])));
		});

		test("each collection stored as WordPress posts has its wp-admin list and editor", async () => {
			const described = JSON.parse((await wordpress.playground.run({ code: describeApp(app) })).text) as { collections: { key: string; postType: string | null }[] };
			for (const { key, postType } of described.collections) {
				if (!postType) continue;
				const list = await get(`/wp-admin/edit.php?post_type=${postType}`);
				assert.equal(list.status, 200, `${key}: wp-admin list`);
				assert.match(list.body, /class="wp-list-table/, `${key}: no list table`);
				const editor = await get(`/wp-admin/post-new.php?post_type=${postType}`);
				assert.equal(editor.status, 200, `${key}: editor`);
				assert.match(editor.body, /block-editor|id="post-body"/, `${key}: no editor`);
			}
		});

		test("the landing page opens, signed in, with the example's data", async () => {
			const landing = await get(example.landing);
			assert.equal(landing.status, 200, `${example.landing}`);
			assert.notEqual(landing.url, "/wp-login.php", `${example.landing} sent the visitor to sign in`);
			assert.doesNotMatch(landing.body, /There has been a critical error|Fatal error/);
			if (example.landing.startsWith("/wp-json/")) {
				// A REST landing page answers JSON; with a seed, it holds the rows the seed wrote.
				const json = JSON.parse(landing.body) as { data?: unknown[] } | unknown[];
				const rows = Array.isArray(json) ? json : json.data;
				assert.ok(Array.isArray(rows), `${example.landing} is not a list`);
				if (example.seed) assert.ok(rows.length > 0, `${example.landing} is empty after the seed ran`);
			}
		});

		for (const [name, check] of Object.entries(exampleChecks)) {
			if (name === example.name) test(check.title, () => check.run(wordpress.serverUrl, get));
		}
	});
}
