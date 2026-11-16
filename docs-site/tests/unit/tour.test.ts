// Every tour stop still points at real lines of the examples and of what the compiler makes of them.
import { test } from "node:test";
import assert from "node:assert/strict";

import { example } from "../../lib/examples.ts";
import { resolveTour } from "../../lib/tour.ts";
import { tours } from "../../lib/stops.ts";

for (const tour of tours) {
  test(`the ${tour.example} tour's anchors match the example and its build output`, async (t) => {
    const compiled = await example(tour.example);
    for (const stop of resolveTour(tour, compiled)) {
      await t.test(stop.slug, () => {
        assert.ok(stop.config.code.trim().length > 0);
        assert.ok(stop.outputs.length > 0);
        for (const pane of [...stop.inputs, ...stop.outputs]) assert.ok(pane.code.trim().length > 0, pane.label);
        // The frontend design lock owns agents; the tour shows none of that surface.
        for (const pane of stop.outputs) assert.doesNotMatch(pane.code, /agents/, pane.label);
      });
    }
  });
}

test("stop slugs are unique within a tour", () => {
  for (const tour of tours) {
    const slugs = tour.stops.map((s) => s.slug);
    assert.deepEqual([...new Set(slugs)], slugs, tour.example);
  }
});

test("every playground example compiles with the First names the editor shows", async () => {
	const { readFileSync } = await import("node:fs");
	const path = await import("node:path");
	const { Compiler } = await import("../../lib/compiler.ts");
	const { firstFiles, compilerFiles } = await import("../../lib/playground-catalog.ts");
	const { siteExamples } = await import("../../lib/site-examples.ts");
	const { sources, repo, site } = await import("../../lib/examples.ts");
	const compiler = await Compiler.load(readFileSync(path.join(site, "public/compiler.wasm")));
	for (const { name } of siteExamples) {
		// What the browser does: show First names, then hand the compiler the names it reads.
		const shown = firstFiles(sources(path.join(repo, "examples", name)));
		assert.ok("typedpress.config.ts" in shown, name);
		const { check } = compiler.compile({ name, files: compilerFiles(shown), previous: null });
		assert.equal(check.ok, true, `${name}: ${check.diagnostics.map((d) => d.message).join("; ")}`);
	}
});

test("every TypeScript block on the client page parses", async () => {
	const { readFileSync } = await import("node:fs");
	const path = await import("node:path");
	const ts = (await import("typescript")).default;
	const { site } = await import("../../lib/examples.ts");
	const page = readFileSync(path.join(site, "docs/reference/client.mdx"), "utf8");
	const blocks = [...page.matchAll(/^```ts[^\n]*\n([\s\S]*?)^```$/gm)].map((m) => m[1]!);
	assert.ok(blocks.length >= 4);
	for (const code of blocks) {
		const file = ts.createSourceFile("block.ts", code, ts.ScriptTarget.Latest, true);
		const errors = (file as unknown as { parseDiagnostics: { messageText: unknown }[] }).parseDiagnostics;
		assert.deepEqual(errors.map((e) => String(e.messageText)), [], code.slice(0, 120));
	}
});
