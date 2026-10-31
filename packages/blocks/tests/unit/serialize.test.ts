import { test } from "node:test";
import assert from "node:assert/strict";

import { blockApi, serializeBlocks } from "../../src/compiler/serialize.ts";
import type { BlockNode } from "../../src/nodes.ts";
import { block, brief, text } from "./helpers.ts";

/**
 * The parity bar is WordPress's own parser, from the same pinned packages the
 * Site Editor runs: markup we emit must parse back to the block we meant, with
 * the attributes we set, and `isValid` (the editor's own check that the
 * markup matches what the block's `save()` produces). Two guarantees, both
 * asserted: validity, and preservation of what the author wrote.
 */
async function reparse(markup: string) {
  const api = await blockApi();
  const flatten = (blocks: ReturnType<typeof api.parse>): { name: string; isValid: boolean; attributes: Record<string, unknown>; inner: unknown[] }[] =>
    blocks.map((b) => ({
      name: b.name,
      isValid: b.isValid,
      // Rich-text attributes come back as RichTextData; the HTML string it stands for is what round-tripped.
      attributes: Object.fromEntries(Object.entries(b.attributes).map(([k, v]) => [k, typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype ? String(v) : v])),
      inner: flatten(b.innerBlocks as ReturnType<typeof api.parse>),
    }));
  return flatten(api.parse(markup));
}

const loc = { file: "/t/page.tsx", line: 3, column: 5 };
const at = (node: BlockNode, line: number): BlockNode => ({ ...node, loc: { ...loc, line } });

test("core blocks round-trip through WordPress's parser valid, with content, nesting and attributes preserved", async () => {
  const { markup, diagnostics } = await serializeBlocks([
    block("core/heading", { level: 3, anchor: "plans" }, [text("Plans")]),
    block("core/group", { tagName: "section", className: "card" }, [
      block("core/paragraph", { className: "lead" }, [text("a "), { kind: "element", tag: "strong", props: {}, children: [text("b")] }, text(" <c>")]),
      block("core/list", { ordered: true }, [block("core/list-item", {}, [text("one")]), block("core/list-item", {}, [text("two")])]),
    ]),
    block("core/image", { url: "/a.png", alt: "A", caption: "cap" }),
    block("core/query", { query: { inherit: true } }, [block("core/post-template", {}, [block("core/post-title", { level: 1 })])]),
  ]);
  assert.deepEqual(diagnostics, []);
  const parsed = await reparse(markup);
  const valid = (nodes: Awaited<ReturnType<typeof reparse>>): boolean => nodes.every((n) => n.isValid && valid(n.inner as typeof nodes));
  assert.ok(valid(parsed), markup);
  assert.deepEqual(parsed.map((p) => p.name), ["core/heading", "core/group", "core/image", "core/query"]);
  assert.deepEqual([parsed[0]!.attributes.level, parsed[0]!.attributes.anchor, parsed[0]!.attributes.content], [3, "plans", "Plans"]);
  assert.deepEqual([parsed[1]!.attributes.tagName, parsed[1]!.attributes.className], ["section", "card"]);
  const [paragraph, list] = parsed[1]!.inner as Awaited<ReturnType<typeof reparse>>;
  assert.deepEqual([paragraph!.attributes.className, paragraph!.attributes.content], ["lead", "a <strong>b</strong> &lt;c&gt;"]);
  assert.deepEqual([list!.attributes.ordered, (list!.inner as { name: string }[]).map((i) => i.name)], [true, ["core/list-item", "core/list-item"]]);
  assert.deepEqual([parsed[2]!.attributes.url, parsed[2]!.attributes.alt, parsed[2]!.attributes.caption], ["/a.png", "A", "cap"]);
  assert.deepEqual(parsed[3]!.attributes.query, { inherit: true });
  assert.deepEqual((parsed[3]!.inner as { name: string; inner: { name: string }[] }[])[0]!.inner.map((i) => i.name), ["core/post-title"]);
});

test("rich text given to a block with no body becomes a paragraph inside it", async () => {
  const { markup } = await serializeBlocks([block("core/cover", { url: "/bg.png" }, [text("Over")])]);
  const [cover] = await reparse(markup);
  assert.equal(cover!.isValid, true);
  assert.deepEqual((cover!.inner as { name: string; attributes: { content: string } }[]).map((i) => [i.name, i.attributes.content]), [["core/paragraph", "Over"]]);
});

test("a Custom HTML block's body is written as inner content and read back verbatim", async () => {
  const { markup, diagnostics } = await serializeBlocks([block("core/html", { content: "<div data-x=\"1\">raw &amp; <b>kept</b></div>" })]);
  assert.deepEqual(diagnostics, []);
  const api = await blockApi();
  const [html] = api.parse(markup);
  assert.equal(html!.name, "core/html");
  assert.equal(html!.isValid, true);
  assert.deepEqual(html!.innerContent?.map((part) => part?.trim()), ["<div data-x=\"1\">raw &amp; <b>kept</b></div>"]);
});

test("an unknown core block, an unknown attribute, a wrong type and an editor-local attribute are located errors with hints", async () => {
  const { markup, diagnostics } = await serializeBlocks([
    at(block("core/paragrph", {}, [text("x")]), 1),
    at(block("core/heading", { levl: 2 }, [text("y")]), 2),
    at(block("core/heading", { level: "2" }, [text("z")]), 3),
    at(block("core/image", { url: "/a.png", blob: "blob:x" }), 4),
    at(block("core/paragraph", { content: "a" }, [text("b")]), 5),
  ]);
  assert.equal(markup, "");
  assert.deepEqual(diagnostics.map(brief), [
    { code: "unknown_block", severity: "error", file: "page.tsx", line: 1, column: 5 },
    { code: "unknown_attribute", severity: "error", file: "page.tsx", line: 2, column: 5 },
    { code: "attribute_type", severity: "error", file: "page.tsx", line: 3, column: 5 },
    { code: "local_attribute", severity: "error", file: "page.tsx", line: 4, column: 5 },
    { code: "content_and_children", severity: "error", file: "page.tsx", line: 5, column: 5 },
  ]);
  assert.equal(diagnostics[0]!.hint, "Did you mean core/paragraph?");
  assert.equal(diagnostics[1]!.hint, 'Did you mean "level"?');
  assert.match(diagnostics[2]!.message, /expects number, got "2"/);
});

test("a save() that throws is a located error instead of silent empty markup", async () => {
  const api = await blockApi();
  api.registerBlockType("zero-test/explodes", {
    apiVersion: 3,
    title: "Explodes",
    category: "widgets",
    attributes: { n: { type: "number" } },
    save: () => {
      throw new Error("no save for you");
    },
  });
  const { markup, diagnostics } = await serializeBlocks([at(block("zero-test/explodes", { n: 1 }), 9)]);
  assert.equal(markup, "");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error").map(brief), [{ code: "save_failed", severity: "error", file: "page.tsx", line: 9, column: 5 }]);
  assert.match(diagnostics.find((d) => d.code === "save_failed")!.message, /no save for you/);
});

test("a third-party block is written as authored at any depth, reported once as unverified, and parses back", async () => {
  const { markup, diagnostics } = await serializeBlocks([
    block("acme/testimonials", { count: 3 }),
    block("core/group", {}, [block("acme/testimonials", { count: 1, theme: "dark" }, [block("core/paragraph", {}, [text("inside")])])]),
  ]);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.severity]), [["unverified_block", "info"]]);
  const parsed = await reparse(markup);
  assert.deepEqual([parsed[0]!.name, parsed[0]!.attributes.count], ["acme/testimonials", 3]);
  const nested = (parsed[1]!.inner as { name: string; attributes: Record<string, unknown> }[])[0]!;
  assert.deepEqual([nested.name, nested.attributes.count, nested.attributes.theme], ["acme/testimonials", 1, "dark"]);
  assert.match(markup, /<!-- wp:acme\/testimonials \{"count":3\} \/-->/);
});

test("an empty tree is an empty document, and a second document serializes like the first", async () => {
  assert.deepEqual(await serializeBlocks([]), { markup: "", diagnostics: [] });
  const tree = [block("core/paragraph", {}, [text("same")])];
  assert.equal((await serializeBlocks(tree)).markup, (await serializeBlocks(tree)).markup);
});
