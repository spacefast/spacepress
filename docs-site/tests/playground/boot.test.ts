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
import { createReadStream, existsSync, readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { siteExamples } from "../../lib/site-examples.ts";
import { site } from "../unit/helpers.ts";

const files = path.join(site, "public/files");

/** public/files/ over HTTP, for the blueprint's First plugin zips. */
function serveFiles(): Promise<http.Server> {
	const server = http.createServer((request, response) => {
		const file = path.join(files, decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname).replace(/^\/files\//, ""));
		if (!file.startsWith(files + path.sep) || !existsSync(file)) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": file.endsWith(".zip") ? "application/zip" : "application/octet-stream" });
		createReadStream(file).pipe(response);
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** fetch with a cookie jar, following redirects: Playground signs the visitor in with a redirect. */
function browser(base: string) {
	const cookies = new Map<string, string>();
	return async (pathname: string): Promise<{ status: number; body: string; url: string }> => {
		let url = new URL(pathname, base);
		for (let hop = 0; hop < 5; hop++) {
			const response = await fetch(url, { redirect: "manual", headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
			for (const header of response.headers.getSetCookie()) {
				const [pair] = header.split(";");
				const at = pair!.indexOf("=");
				cookies.set(pair!.slice(0, at), pair!.slice(at + 1));
			}
			const location = response.headers.get("location");
			if (response.status >= 300 && response.status < 400 && location) {
				await response.arrayBuffer();
				url = new URL(location, url);
				continue;
			}
			return { status: response.status, body: await response.text(), url: url.pathname };
		}
		throw new Error(`too many redirects from ${pathname}`);
	};
}

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

// Each collection's list route, as the admin, through WordPress's REST server.
const restStatus = (keys: string[]) => `<?php
require_once '/wordpress/wp-load.php';
wp_set_current_user(1);
$out = [];
foreach (json_decode(base64_decode('${Buffer.from(JSON.stringify(keys)).toString("base64")}'), true) as $key) {
	$out[$key] = rest_do_request(new WP_REST_Request('GET', '/first/v1/' . $key))->get_status();
}
echo wp_json_encode($out);
`;

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
	});
}
