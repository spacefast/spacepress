import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { compileContent } from "../../src/compiler/content.ts";
import { withBlockApi } from "../../src/compiler/serialize.ts";
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

test("a key after a spread compiles like any other paragraph", async () => {
  const result = await compileContent(fixture("spread-key.tsx"));
  assert.deepEqual(result.diagnostics, []);
  const [paragraph] = await reparse(result.markup);
  assert.deepEqual([paragraph!.name, paragraph!.attributes.className, paragraph!.attributes.content], ["core/paragraph", "lead", "Row a"]);
});

test("a mistake on an element the classic fallback built, at any depth, is located at the nearest located element", async () => {
  const result = await compileContent(fixture("spread-key-style.tsx"));
  assert.deepEqual(result.diagnostics.map(brief), [{ code: "style_prop_unsupported", severity: "error", file: fixture("spread-key-style.tsx"), line: 4, column: 5 }]);
});

test("an error from a classic-fallback element inside a component names the component's line and where it was used", async () => {
  const result = await compileContent(fixture("uses-fallback-card.tsx"));
  // esbuild gives the classic fallback no position, so the line comes from the stack: the authored line, at the call's column.
  assert.deepEqual(result.diagnostics.map((d) => [d.code, d.loc?.file, d.loc?.line]), [["not_content", fixture("fallback-card.tsx"), 3]]);
  assert.deepEqual(result.diagnostics[0]!.loc?.usedAt, { file: fixture("uses-fallback-card.tsx"), line: 7, column: 7 });
});

test("a thrown error is located in the author's file when the author's and the scratch paths contain spaces, parentheses and a colon", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "zero blocks (1) "));
  const authored = path.join(base, "my site (2)");
  const scratch = path.join(base, "tmp: dir");
  cpSync(fixture("throws.tsx"), path.join(authored, "throws.tsx"), { recursive: true });
  mkdirSync(scratch);
  const before = process.env.TMPDIR;
  process.env.TMPDIR = scratch;
  try {
    const result = await compileContent(path.join(authored, "throws.tsx"));
    assert.deepEqual(result.diagnostics.map(brief), [{ code: "module_failed", severity: "error", file: path.join(authored, "throws.tsx"), line: 2, column: 9 }]);
    const fallback = await compileContent(fixture("uses-fallback-card.tsx"));
    assert.deepEqual(fallback.diagnostics.map((d) => [d.code, d.loc?.file, d.loc?.usedAt?.line]), [["not_content", fixture("fallback-card.tsx"), 7]]);
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    rmSync(base, { recursive: true, force: true });
  }
});

test("a stack frame naming a longer path that ends with the bundle's path is not the bundle's frame", async () => {
  const result = await compileContent(fixture("decoy-frame.tsx"));
  assert.deepEqual(result.diagnostics.map(brief), [{ code: "module_failed", severity: "error", file: fixture("decoy-frame.tsx"), line: 8, column: 17 }]);
});

test("compiling from inside withBlockApi is refused, since the module would see the DOM, and the globals are still restored", async () => {
  const scratchRoot = mkdtempSync(path.join(tmpdir(), "zero-blocks-scratch-"));
  const before = process.env.TMPDIR;
  process.env.TMPDIR = scratchRoot;
  try {
    await assert.rejects(withBlockApi(() => compileContent(fixture("sees-dom.tsx"))), /cannot start inside the block API/);
    // The refused compile had already made its scratch directory; it is cleaned up like any other.
    assert.deepEqual(readdirSync(scratchRoot), []);
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    rmSync(scratchRoot, { recursive: true, force: true });
  }
  assert.equal("document" in globalThis, false);
  const after = await compileContent(fixture("sees-dom.tsx"));
  assert.match(after.markup, /<p>undefined\/undefined<\/p>/);
});

test("a module never sees the serializer's DOM, whatever else is compiling at the same time", async () => {
  const results = await Promise.all([
    compileContent(fixture("sees-dom.tsx")),
    compileContent(fixture("pricing.tsx")),
    compileContent(fixture("sees-dom.tsx")),
    compileContent(fixture("pricing.tsx")),
    compileContent(fixture("sees-dom.tsx")),
  ]);
  for (const result of [results[0], results[2], results[4]]) {
    assert.deepEqual(result!.diagnostics, []);
    assert.match(result!.markup, /<p>undefined\/undefined<\/p>/);
  }
  assert.equal("document" in globalThis, false);
});

test("a mistake inside a component names the component's line and where it was used", async () => {
  const result = await compileContent(fixture("uses-card.tsx"));
  assert.deepEqual(result.diagnostics.map(brief), [{ code: "style_prop_unsupported", severity: "error", file: fixture("card.tsx"), line: 3, column: 10 }]);
  assert.deepEqual(result.diagnostics[0]!.loc?.usedAt, { file: fixture("uses-card.tsx"), line: 7, column: 7 });
});

test("a malformed node a module hands back at the top is refused as not content, at the file", async () => {
  const top = await compileContent(fixture("malformed-node.tsx"));
  assert.deepEqual(top.diagnostics.map(brief), [{ code: "not_content", severity: "error", file: fixture("malformed-node.tsx"), line: 1, column: 1 }]);
});

test("a malformed node nested in JSX is refused as not content, at the element holding it", async () => {
  const nested = await compileContent(fixture("nested-malformed.tsx"));
  assert.deepEqual(nested.diagnostics.map(brief), [{ code: "not_content", severity: "error", file: fixture("nested-malformed.tsx"), line: 2, column: 10 }]);
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

test("a value that is not content is refused at the element holding it", async () => {
  const inside = await compileContent(fixture("not-content.tsx"));
  assert.deepEqual(inside.diagnostics.map(brief), [{ code: "not_content", severity: "error", file: fixture("not-content.tsx"), line: 5, column: 7 }]);
});

test("a default export that returns a value that is not content is refused at the file", async () => {
  const returned = await compileContent(fixture("returns-date.tsx"));
  assert.deepEqual(returned.diagnostics.map(brief), [{ code: "not_content", severity: "error", file: fixture("returns-date.tsx"), line: 1, column: 1 }]);
  assert.equal(returned.markup, "");
});

test("a static node: import fails to bundle, at the import", async () => {
  const result = await compileContent(fixture("reads-fs.tsx"));
  assert.deepEqual(result.diagnostics.map(brief), [{ code: "module_failed", severity: "error", file: fixture("reads-fs.tsx"), line: 1, column: 30 }]);
  assert.match(result.diagnostics[0]!.message, /node:fs/);
});
