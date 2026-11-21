// "Run in WordPress" on the playground page runs the config in the editor, not only the committed
// example. This edits examples/pantry's config the way a visitor would, adding a text field to the
// `items` table, compiles it with the browser compiler (public/compiler.wasm), builds the blueprint
// with the same functions the page uses (lib/blueprint.ts `runRequest` and `editedBlueprint`), boots
// it with @wp-playground/cli, and checks WordPress stores and answers the new field.
//
// TypedPress's shared plugin zips are served from public/files/ on a local port; WordPress, PHP and the
// WordPress.org plugins come over the network as they do for a visitor. Run `pnpm showcase` first.
import { runCLI, type RunCLIServer } from "@wp-playground/cli";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";

import { editedBlueprint, runRequest } from "../../lib/blueprint.ts";
import { loadCompiler, sources } from "../../lib/examples.ts";
import { platformVersions } from "../../lib/platform.ts";
import { compilerFiles, firstFiles } from "../../lib/playground-catalog.ts";
import { exampleRun } from "../../lib/showcase.ts";
import { repo, site } from "../unit/helpers.ts";
import { browser, serveFiles } from "./helpers.ts";

const files = path.join(site, "public/files");

// Writes an item through the app's API as the admin (in process), then reads the list over HTTP below,
// as a visitor's browser reads it.
const create = `<?php
require_once '/wordpress/wp-load.php';
wp_set_current_user(1);
echo \\TypedPress\\Wp\\Facade::route(\\TypedPress\\Wp\\Runtime::plugin(), 'POST', '/items', [], wp_json_encode(['name' => 'Oat milk', 'quantity' => 3, 'unit' => 'l', 'lowStockAt' => 1, 'note' => 'top shelf']))[0];
`;

/** The items the API lists, over HTTP, as the signed-in visitor. */
async function items(): Promise<Record<string, unknown>[]> {
	const response = await get("/wp-json/typedpress/v1/items");
	assert.equal(response.status, 200, response.body);
	const json = JSON.parse(response.body) as { data?: Record<string, unknown>[] } | Record<string, unknown>[];
	const rows = Array.isArray(json) ? json : json.data;
	assert.ok(Array.isArray(rows), response.body);
	return rows;
}

let zips: http.Server;
let wordpress: RunCLIServer;
let seeded: boolean;
let get: ReturnType<typeof browser>;

before(async () => {
	if (!existsSync(path.join(files, "plugins/typedpress-runtime.zip"))) throw new Error("public/files/plugins/typedpress-runtime.zip is missing; run pnpm showcase");
	zips = await serveFiles();
	const { port } = zips.address() as AddressInfo;

	// The editor holds First names; the page hands the compiler the names it reads.
	const shown = firstFiles(sources(path.join(repo, "examples/pantry")));
	const config = shown["typedpress.config.ts"]!;
	const edited = config.replace("  opened: boolean().default(false),", "  opened: boolean().default(false),\n  note: text().optional(),");
	assert.notEqual(edited, config, "the edit did not apply; examples/pantry changed");
	const run = await exampleRun("pantry");
	const { check, output } = (await loadCompiler()).compile(runRequest("pantry", compilerFiles({ ...shown, "typedpress.config.ts": edited }), run.ledger));
	assert.ok(output, JSON.stringify(check.diagnostics));
	const built = editedBlueprint({ output, example: run, site: `http://127.0.0.1:${port}`, platform: platformVersions() });
	assert.ok(!("refused" in built), "refused" in built ? built.refused : "");
	seeded = built.seeded;

	const boot = () => runCLI({ command: "server", port: 0, blueprint: built.blueprint as never, verbosity: "quiet" });
	wordpress = await boot().catch((error: Error) => {
		if (!/Could not download/.test(String(error?.message))) throw error;
		return boot();
	});
	get = browser(wordpress.serverUrl);
});
after(async () => {
	await wordpress?.[Symbol.asyncDispose]();
	zips?.close();
});

test("the example's seed does not run against a schema the edit changed", async () => {
	assert.equal(seeded, false);
	assert.deepEqual(await items(), []);
});

test("an edited config runs: the field it adds is stored and answered on the REST API", async () => {
	assert.equal((await wordpress.playground.run({ code: create })).text, "201");
	const oat = (await items()).find((row) => row.name === "Oat milk");
	assert.ok(oat);
	assert.equal(oat.note, "top shelf");
});
