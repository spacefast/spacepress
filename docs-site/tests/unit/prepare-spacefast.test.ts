// scripts/prepare-spacefast.mjs, run on a dist/ with the _headers Blume 2.2.7 writes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { site } from "./helpers.ts";

// Kept as Blume 2.2.7 wrote it for this site, rule for rule.
const blumeHeaders = readFileSync(path.join(site, "tests/unit/fixtures/blume-headers.txt"), "utf8");

/** The rules a _headers file holds: path → header lines. */
function parse(text: string): [string, string[]][] {
	const rules: [string, string[]][] = [];
	for (const line of text.split("\n")) {
		if (line.startsWith("/")) rules.push([line, []]);
		else if (line.trim()) rules.at(-1)![1].push(line.trim());
	}
	return rules;
}

function prepare(): { headers: [string, string[]][]; page: string } {
	const dist = mkdtempSync(path.join(tmpdir(), "first-dist-"));
	mkdirSync(path.join(dist, "guide"));
	writeFileSync(path.join(dist, "_headers"), blumeHeaders);
	writeFileSync(path.join(dist, "guide/index.md"), "# Guide\n");
	const run = spawnSync(process.execPath, [path.join(site, "scripts/prepare-spacefast.mjs"), dist], { encoding: "utf8" });
	assert.equal(run.status, 0, run.stderr);
	return { headers: parse(readFileSync(path.join(dist, "_headers"), "utf8")), page: readFileSync(path.join(dist, "guide/index.md"), "utf8") };
}

test("no rule that covers whole folders sets a Content-Type, so HTML pages stay HTML", () => {
	const { headers } = prepare();
	for (const [rule, lines] of headers) {
		if (!rule.endsWith("*")) continue;
		assert.ok(!lines.some((line) => /^content-type:/i.test(line)), `${rule} sets ${lines.join("; ")}`);
	}
});

test("every rule has a wildcard only as its last segment", () => {
	for (const [rule] of prepare().headers) assert.match(rule, /^[^*]*(\/\*)?$/, rule);
});

test("the SVG sandbox, the agent discovery headers and the Link header stay; and the compiler is wasm", () => {
	// Rules for one path add up, as they do on the server.
	const headers = new Map<string, string[]>();
	for (const [rule, lines] of prepare().headers) headers.set(rule, [...(headers.get(rule) ?? []), ...lines]);
	assert.deepEqual(headers.get("/blume-assets/*"), ["Content-Security-Policy: sandbox", "X-Content-Type-Options: nosniff"]);
	assert.deepEqual(headers.get("/compiler.wasm"), ["Content-Type: application/wasm"]);
	// Spacefast sends the CORS header on every response; a second copy would break Playground's fetch.
	assert.equal(headers.get("/files/*"), undefined);
	assert.deepEqual(headers.get("/.well-known/api-catalog"), ['Content-Type: application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"', "Access-Control-Allow-Origin: *"]);
	assert.deepEqual(headers.get("/.well-known/ai-catalog.json"), ["Access-Control-Allow-Origin: *"]);
	assert.match(headers.get("/")?.join("\n") ?? "", /^Link: <\/\.well-known\/api-catalog>; rel="api-catalog"/);
});

test("Markdown copies are served as written", () => {
	assert.equal(prepare().page, "---\nraw: true\n---\n\n# Guide\n");
});
