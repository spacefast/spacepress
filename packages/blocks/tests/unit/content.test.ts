import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compileContent } from "../../src/compiler/content.ts";
import { allValid, brief, fixture, names, reparse } from "./helpers.ts";

test("a file's imports, loops and components run at build time and become valid blocks", async () => {
  const result = await compileContent(fixture("pricing.tsx"));
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
  assert.deepEqual(names(result.blocks), ["core/heading", "core/paragraph", "core/group", "core/group", "core/image", "core/list", "core/quote", "core/code", "core/table", "core/details", "core/separator", "acme/testimonials"]);
  const parsed = await reparse(result.markup);
  assert.ok(allValid(parsed));
  // The second plan's list has the two perks the data module declared.
  const pro = parsed[3]!;
  assert.deepEqual(pro.inner.map((b) => b.name), ["core/heading", "core/paragraph", "core/list"]);
  assert.equal(pro.inner[2]!.inner.length, 2);
  assert.equal(parsed[1]!.attributes.content, "Simple, <strong>honest</strong> pricing &amp; no surprises: 5 &lt; 6.");
});

test("the compiled markup is stable (drift guard)", async () => {
  const result = await compileContent(fixture("pricing.tsx"));
  // The CLI appends the trailing newline a file wants; the compiler result has none.
  assert.equal(`${result.markup}\n`, readFileSync(fixture("pricing.golden.html"), "utf8"));
});

test("a style prop and an unmappable tag report the author's absolute file, line and column, and nothing is written", async () => {
  const result = await compileContent(fixture("styled.tsx"));
  assert.equal(result.markup, "");
  assert.deepEqual(result.diagnostics.map(brief), [
    { code: "style_prop_unsupported", severity: "error", file: fixture("styled.tsx"), line: 5, column: 7 },
    { code: "unmappable_element", severity: "error", file: fixture("styled.tsx"), line: 6, column: 9 },
  ]);
});

test("a wrong block attribute is reported at the JSX that used the component", async () => {
  const result = await compileContent(fixture("bad-attribute.tsx"));
  assert.deepEqual(result.diagnostics.map(brief), [{ code: "unknown_attribute", severity: "error", file: fixture("bad-attribute.tsx"), line: 9, column: 7 }]);
});

test("a module with no default export says so", async () => {
  const result = await compileContent(fixture("no-default.tsx"));
  assert.deepEqual(result.diagnostics.map(brief), [{ code: "default_export_missing", severity: "error", file: fixture("no-default.tsx"), line: 1, column: 1 }]);
});

test("a throw while rendering points at the author's line through the source map", async () => {
  const result = await compileContent(fixture("throws.tsx"));
  assert.deepEqual(result.diagnostics.map(brief), [{ code: "module_failed", severity: "error", file: fixture("throws.tsx"), line: 2, column: 9 }]);
  assert.match(result.diagnostics[0]!.message, /boom at build time/);
});

test("a value that is not content is refused at the element holding it, or at the file when the default export returned it", async () => {
  const inside = await compileContent(fixture("not-content.tsx"));
  assert.deepEqual(inside.diagnostics.map(brief), [{ code: "not_content", severity: "error", file: fixture("not-content.tsx"), line: 5, column: 7 }]);
  const returned = await compileContent(fixture("returns-date.tsx"));
  assert.deepEqual(returned.diagnostics.map(brief), [{ code: "not_content", severity: "error", file: fixture("returns-date.tsx"), line: 1, column: 1 }]);
  assert.equal(returned.markup, "");
});

test("a static node: import fails to bundle, at the import", async () => {
  const result = await compileContent(fixture("reads-fs.tsx"));
  assert.deepEqual(result.diagnostics.map(brief), [{ code: "module_failed", severity: "error", file: fixture("reads-fs.tsx"), line: 1, column: 30 }]);
  assert.match(result.diagnostics[0]!.message, /node:fs/);
});
