import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compileContent } from "../../src/compiler/content.ts";
import { blockApi } from "../../src/compiler/serialize.ts";
import { brief, fixture, names } from "./helpers.ts";

test("a file's imports, loops and components run at build time and become valid blocks", async () => {
  const result = await compileContent(fixture("pricing.tsx"));
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
  assert.deepEqual(names(result.blocks), ["core/heading", "core/paragraph", "core/group", "core/group", "core/image", "acme/testimonials"]);
  const api = await blockApi();
  const parsed = api.parse(result.markup);
  const valid = (blocks: typeof parsed): boolean => blocks.every((b) => b.isValid && valid(b.innerBlocks as typeof parsed));
  assert.ok(valid(parsed));
  // The second plan's list has the two perks the data module declared.
  const pro = parsed[3]!;
  assert.deepEqual(pro.innerBlocks.map((b) => b.name), ["core/heading", "core/paragraph", "core/list"]);
  assert.equal(pro.innerBlocks[2]!.innerBlocks.length, 2);
  assert.equal(String(parsed[1]!.attributes.content), "Simple, <strong>honest</strong> pricing &amp; no surprises: 5 &lt; 6.");
});

test("the compiled markup is stable (drift guard)", async () => {
  const result = await compileContent(fixture("pricing.tsx"));
  // The CLI appends the trailing newline a file wants; the compiler result has none.
  assert.equal(`${result.markup}\n`, readFileSync(fixture("pricing.golden.html"), "utf8"));
});

test("a style prop and an unmappable tag report the author's file, line and column, and nothing is written", async () => {
  const result = await compileContent(fixture("styled.tsx"));
  assert.equal(result.markup, "");
  assert.deepEqual(result.diagnostics.map(brief), [
    { code: "style_prop_unsupported", severity: "error", file: "styled.tsx", line: 5, column: 7 },
    { code: "unmappable_element", severity: "error", file: "styled.tsx", line: 6, column: 9 },
  ]);
});

test("a wrong block attribute is reported at the JSX that used the component", async () => {
  const result = await compileContent(fixture("bad-attribute.tsx"));
  assert.deepEqual(result.diagnostics.map(brief), [{ code: "unknown_attribute", severity: "error", file: "bad-attribute.tsx", line: 9, column: 7 }]);
});

test("a module with no default export, one that throws, one that is not content, and one that reads the filesystem each fail with a location", async () => {
  const noDefault = await compileContent(fixture("no-default.tsx"));
  assert.deepEqual(noDefault.diagnostics.map(brief), [{ code: "default_export_missing", severity: "error", file: "no-default.tsx", line: 1, column: 1 }]);

  const throws = await compileContent(fixture("throws.tsx"));
  assert.deepEqual(throws.diagnostics.map(brief), [{ code: "module_failed", severity: "error", file: "throws.tsx", line: 2, column: 9 }]);
  assert.match(throws.diagnostics[0]!.message, /boom at build time/);

  const notContent = await compileContent(fixture("not-content.tsx"));
  assert.deepEqual(notContent.diagnostics.map(brief), [{ code: "not_content", severity: "error", file: "not-content.tsx", line: 5, column: 7 }]);

  const fs = await compileContent(fixture("reads-fs.tsx"));
  assert.deepEqual(fs.diagnostics.map(brief), [{ code: "module_failed", severity: "error", file: "reads-fs.tsx", line: 1, column: 30 }]);
  assert.match(fs.diagnostics[0]!.message, /node:fs/);
});
