// The browser compiler's app plugin is the one `first build` writes. For each site example, the
// files the playground page sends to WordPress Playground (the wasm compile's `appPlugin`, with the
// example's committed migration ledger) equal, byte for byte, the files inside the
// first-app-<name>.zip that the native build wrote for the same sources (`pnpm showcase`).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { runRequest } from "../../lib/blueprint.ts";
import { loadCompiler, sources } from "../../lib/examples.ts";
import { ledger } from "../../lib/showcase.ts";
import { siteExamples } from "../../lib/site-examples.ts";
import { site } from "./helpers.ts";

const showcase = path.join(site, ".showcase");
const scratch = mkdtempSync(path.join(tmpdir(), "first-app-plugin-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** Every file under `root`, by path below it. */
function read(root: string, rel = ""): Record<string, Buffer> {
	const out: Record<string, Buffer> = {};
	for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
		const sub = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(out, read(root, sub));
		else out[sub] = readFileSync(path.join(root, sub));
	}
	return out;
}

for (const { name } of siteExamples) {
	test(`examples/${name}: the browser compiler's app plugin is the zip \`first build\` wrote`, async () => {
		const built = path.join(showcase, name);
		const plugins = path.join(built, "first/dist/wp-content/plugins");
		if (!existsSync(plugins)) throw new Error(`${plugins} is missing; run pnpm showcase`);
		const app = (JSON.parse(readFileSync(path.join(built, "first/dist/wp-content/first-manifest.json"), "utf8")) as { app: string }).app;
		const zip = path.join(plugins, `first-app-${app}.zip`);
		const out = path.join(scratch, name);
		const unzip = spawnSync("unzip", ["-q", "-o", zip, "-d", out], { encoding: "utf8" });
		assert.equal(unzip.status, 0, unzip.stderr);
		const native = read(out);

		// The sources as committed (with the example's installed npm packages, which the showcase
		// build installed in its copy), and the ledger as committed.
		const example = path.join(site, "..", "examples", name);
		const files = { ...sources(example), ...Object.fromEntries(Object.entries(sources(built)).filter(([file]) => file.startsWith("node_modules/"))) };
		const { check, output } = (await loadCompiler()).compile(runRequest(name, files, ledger(example)));
		assert.ok(output, JSON.stringify(check.diagnostics));
		assert.deepEqual(output.firstPlugins, Object.keys((JSON.parse(readFileSync(path.join(built, "first/dist/wp-content/first-manifest.json"), "utf8")) as { plugins: Record<string, string> }).plugins).filter((slug) => slug.startsWith("first-")));
		const wasm = Object.fromEntries(Object.entries(output.appPlugin).map(([file, text]) => [file, Buffer.from(text, "utf8")]));
		assert.deepEqual(Object.keys(wasm).sort(), Object.keys(native).sort());
		for (const file of Object.keys(native)) assert.ok(wasm[file]!.equals(native[file]!), `${file} differs`);
	});
}
