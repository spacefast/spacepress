import { test } from "node:test";
import assert from "node:assert/strict";

import { fitsAttribute, isPlainObject, serializeBlocks, withBlockApi } from "../../src/compiler/serialize.ts";
import { allValid, at, block, brief, reparse, text } from "./helpers.ts";

/**
 * The parity bar is WordPress's own parser, from the same pinned packages the
 * Site Editor runs: markup we emit must parse back to the block we meant, with
 * the attributes we set, and `isValid` (the editor's own check that the markup
 * matches what the block's `save()` produces). Two guarantees, both asserted:
 * validity, and preservation of what the author wrote.
 */

test("a paragraph round-trips valid with its rich text and class", async () => {
  const { markup, diagnostics } = await serializeBlocks([
    block("core/paragraph", { className: "lead" }, [text("a "), { kind: "element", tag: "strong", props: {}, children: [text("b")] }, text(" <c>")]),
  ]);
  assert.deepEqual(diagnostics, []);
  const [p] = await reparse(markup);
  assert.deepEqual([p!.name, p!.isValid, p!.attributes.className, p!.attributes.content], ["core/paragraph", true, "lead", "a <strong>b</strong> &lt;c&gt;"]);
});

test("a heading keeps its level and anchor", async () => {
  const [h] = await reparse((await serializeBlocks([block("core/heading", { level: 3, anchor: "plans" }, [text("Plans")])])).markup);
  assert.deepEqual([h!.isValid, h!.attributes.level, h!.attributes.anchor, h!.attributes.content], [true, 3, "plans", "Plans"]);
});

test("a group nests its inner blocks inside the tag it was given", async () => {
  const [g] = await reparse((await serializeBlocks([block("core/group", { tagName: "section", className: "card" }, [block("core/paragraph", {}, [text("in")])])])).markup);
  assert.deepEqual([g!.isValid, g!.attributes.tagName, g!.attributes.className, g!.inner.map((i) => [i.name, i.isValid])], [true, "section", "card", [["core/paragraph", true]]]);
});

test("a list nests its items as inner blocks and keeps the ordered flag", async () => {
  const [l] = await reparse((await serializeBlocks([block("core/list", { ordered: true }, [block("core/list-item", {}, [text("one")]), block("core/list-item", {}, [text("two")])])])).markup);
  assert.deepEqual([l!.isValid, l!.attributes.ordered, l!.inner.map((i) => [i.name, i.attributes.content])], [true, true, [["core/list-item", "one"], ["core/list-item", "two"]]]);
});

test("an image's sourced attributes (url, alt, caption) survive the round trip valid", async () => {
  const [img] = await reparse((await serializeBlocks([block("core/image", { url: "/a.png", alt: "A", caption: "cap" })])).markup);
  assert.deepEqual([img!.isValid, img!.attributes.url, img!.attributes.alt, img!.attributes.caption], [true, "/a.png", "A", "cap"]);
});

test("a query loop with inherit and post blocks (no save of their own) is valid at every depth", async () => {
  const [q] = await reparse((await serializeBlocks([block("core/query", { query: { inherit: true } }, [block("core/post-template", {}, [block("core/post-title", { level: 1 })])])])).markup);
  assert.ok(allValid([q!]));
  assert.deepEqual([q!.attributes.query, q!.inner[0]!.inner.map((i) => [i.name, i.attributes.level])], [{ inherit: true }, [["core/post-title", 1]]]);
});

test("a quote's inner paragraph survives the round trip", async () => {
  const [q] = await reparse((await serializeBlocks([block("core/quote", {}, [block("core/paragraph", {}, [text("Quoted.")])])])).markup);
  assert.deepEqual([q!.isValid, q!.inner.map((i) => [i.name, i.attributes.content])], [true, [["core/paragraph", "Quoted."]]]);
});

test("a code block keeps its text with markup characters escaped", async () => {
  const [c] = await reparse((await serializeBlocks([block("core/code", {}, [text("const a = 1 < 2;")])])).markup);
  assert.deepEqual([c!.isValid, c!.attributes.content], [true, "const a = 1 &lt; 2;"]);
});

test("a table's head and body cells survive as structured attributes", async () => {
  const table = block("core/table", { head: [{ cells: [{ content: "Plan", tag: "th" }] }], body: [{ cells: [{ content: "Free", tag: "td" }] }], foot: [] });
  const [t] = await reparse((await serializeBlocks([table])).markup);
  type Rows = { cells: { content: unknown; tag: string }[] }[];
  const cells = (rows: unknown) => (rows as Rows).map((r) => r.cells.map((c) => [c.tag, String(c.content)]));
  assert.deepEqual([t!.isValid, cells(t!.attributes.head), cells(t!.attributes.body)], [true, [[["th", "Plan"]]], [[["td", "Free"]]]]);
});

test("a details block keeps its summary attribute and its body blocks", async () => {
  const [d] = await reparse((await serializeBlocks([block("core/details", { summary: "More" }, [block("core/paragraph", {}, [text("Hidden.")])])])).markup);
  assert.deepEqual([d!.isValid, d!.attributes.summary, d!.inner.map((i) => i.attributes.content)], [true, "More", ["Hidden."]]);
});

test("a nested list rides inside its list item beside the item's text", async () => {
  const tree = block("core/list", { ordered: true }, [block("core/list-item", {}, [text("First"), block("core/list", {}, [block("core/list-item", {}, [text("Nested")])])])]);
  const [l] = await reparse((await serializeBlocks([tree])).markup);
  const item = l!.inner[0]!;
  assert.deepEqual([l!.isValid, item.isValid, item.attributes.content, item.inner.map((i) => [i.name, i.inner[0]!.attributes.content])], [true, true, "First", [["core/list", "Nested"]]]);
});

test("rich text given to a block with no body becomes a paragraph inside it", async () => {
  const [cover] = await reparse((await serializeBlocks([block("core/cover", { url: "/bg.png" }, [text("Over")])])).markup);
  assert.equal(cover!.isValid, true);
  assert.deepEqual(cover!.inner.map((i) => [i.name, i.attributes.content]), [["core/paragraph", "Over"]]);
});

test("a Custom HTML block's body is written as inner content and read back verbatim", async () => {
  const { markup, diagnostics } = await serializeBlocks([block("core/html", { content: '<div data-x="1">raw &amp; <b>kept</b></div>' })]);
  assert.deepEqual(diagnostics, []);
  const [html] = await reparse(markup);
  assert.deepEqual([html!.name, html!.isValid, html!.innerContent.map((part) => part?.trim())], ["core/html", true, ['<div data-x="1">raw &amp; <b>kept</b></div>']]);
});

test("an attribute's enum is the whole set of values it accepts", () => {
  assert.equal(fitsAttribute({ type: "string", enum: ["left", "right"] }, "left"), true);
  assert.equal(fitsAttribute({ type: "string", enum: ["left", "right"] }, "bogus"), false);
});

test("an attribute's type array is a union", () => {
  assert.equal(fitsAttribute({ type: ["string", "boolean"] }, false), true);
  assert.equal(fitsAttribute({ type: ["string", "boolean"] }, 1), false);
});

test("an integer attribute excludes fractions", () => {
  assert.equal(fitsAttribute({ type: "integer" }, 1), true);
  assert.equal(fitsAttribute({ type: "integer" }, 1.5), false);
});

test("rich-text is a string attribute", () => {
  assert.equal(fitsAttribute({ type: "rich-text" }, "x"), true);
  assert.equal(fitsAttribute({ type: "rich-text" }, 1), false);
});

test("an object attribute takes a plain object only", () => {
  assert.equal(fitsAttribute({ type: "object" }, { a: 1 }), true);
  assert.equal(fitsAttribute({ type: "object" }, new Date(0)), false);
  assert.deepEqual([isPlainObject(Object.create(null)), isPlainObject([]), isPlainObject(new Map())], [true, false, false]);
});

test("a block the editor cannot recognise does not count as valid, even though core/missing parses", async () => {
  const parsed = await reparse("<!-- wp:never/registered {\"a\":1} /-->");
  assert.deepEqual([parsed[0]!.name, parsed[0]!.isValid], ["core/missing", true]);
  assert.equal(allValid(parsed), false);
});

test("an unknown core block is a located error naming the nearest block", async () => {
  const { markup, diagnostics } = await serializeBlocks([at(block("core/paragrph", {}, [text("x")]), 1)]);
  assert.equal(markup, "");
  assert.deepEqual(diagnostics.map(brief), [{ code: "unknown_block", severity: "error", file: "/t/page.tsx", line: 1, column: 5 }]);
  assert.equal(diagnostics[0]!.hint, "Did you mean core/paragraph?");
});

test("an unknown attribute is a located error naming the nearest attribute", async () => {
  const typo = await serializeBlocks([at(block("core/heading", { levl: 2 }, [text("y")]), 2)]);
  assert.deepEqual(typo.diagnostics.map(brief), [{ code: "unknown_attribute", severity: "error", file: "/t/page.tsx", line: 2, column: 5 }]);
  assert.equal(typo.diagnostics[0]!.hint, 'Did you mean "level"?');
});

test("inherited object keys are not registered attributes", async () => {
  const inherited = await serializeBlocks([at(block("core/paragraph", { toString: "lost", constructor: "lost" }, [text("y")]), 3)]);
  assert.deepEqual(inherited.diagnostics.map((d) => d.code), ["unknown_attribute", "unknown_attribute"]);
});

test("a value of the wrong type is a located error that names both types", async () => {
  const wrongType = await serializeBlocks([at(block("core/heading", { level: "2" }, [text("z")]), 3)]);
  assert.deepEqual(wrongType.diagnostics.map(brief), [{ code: "attribute_type", severity: "error", file: "/t/page.tsx", line: 3, column: 5 }]);
  assert.match(wrongType.diagnostics[0]!.message, /expects number, got "2"/);
});

test("a value outside an attribute's enum is an error that lists the enum", async () => {
  const outsideEnum = await serializeBlocks([at(block("core/paragraph", { align: "bogus" }, [text("z")]), 4)]);
  assert.deepEqual(outsideEnum.diagnostics.map((d) => [d.code, d.loc?.line]), [["attribute_type", 4]]);
  assert.match(outsideEnum.diagnostics[0]!.message, /"left" \| "center" \| "right"/);
});

test("a non-plain object is not an object attribute", async () => {
  const notPlain = await serializeBlocks([at(block("core/paragraph", { style: new Date(0) }, [text("z")]), 5)]);
  assert.deepEqual(notPlain.diagnostics.map((d) => [d.code, d.loc?.line]), [["attribute_type", 5]]);
});

test("an editor-local attribute is refused", async () => {
  const { markup, diagnostics } = await serializeBlocks([at(block("core/image", { url: "/a.png", blob: "blob:x" }), 4)]);
  assert.equal(markup, "");
  assert.deepEqual(diagnostics.map(brief), [{ code: "local_attribute", severity: "error", file: "/t/page.tsx", line: 4, column: 5 }]);
});

test("core/html's content is editor-local too, but it is the block's body and is accepted", async () => {
  assert.deepEqual((await serializeBlocks([block("core/html", { content: "<b>x</b>" })])).diagnostics, []);
});

test("a block with a content attribute and rich-text children is refused", async () => {
  const richText = await serializeBlocks([at(block("core/paragraph", { content: "a" }, [text("b")]), 5)]);
  assert.deepEqual(richText.diagnostics.map(brief), [{ code: "content_and_children", severity: "error", file: "/t/page.tsx", line: 5, column: 5 }]);
});

test("a block with a content attribute and a child block is refused", async () => {
  const childBlock = await serializeBlocks([at(block("core/paragraph", { content: "FIRST" }, [block("core/paragraph", {}, [text("SECOND")])]), 6)]);
  assert.deepEqual(childBlock.diagnostics.map((d) => [d.code, d.loc?.line]), [["content_and_children", 6]]);
});

test("a Custom HTML block with both content and children is refused", async () => {
  const html = await serializeBlocks([at(block("core/html", { content: "<b>a</b>" }, [text("b")]), 7)]);
  assert.deepEqual(html.diagnostics.map((d) => [d.code, d.loc?.line]), [["content_and_children", 7]]);
});

test("a third-party block with both content and children is refused", async () => {
  const thirdParty = await serializeBlocks([at(block("acme/x", { content: "a" }, [text("b")]), 8)]);
  assert.deepEqual(thirdParty.diagnostics.filter((d) => d.severity === "error").map((d) => [d.code, d.loc?.line]), [["content_and_children", 8]]);
});

test("a child block a paragraph cannot hold is refused rather than dropped", async () => {
  const paragraph = await serializeBlocks([block("core/paragraph", {}, [text("p"), at(block("core/heading", { level: 2 }, [text("h")]), 3)])]);
  assert.equal(paragraph.markup, "");
  assert.deepEqual(paragraph.diagnostics.map((d) => [d.code, d.loc?.line]), [["unmappable_element", 3]]);
  assert.match(paragraph.diagnostics[0]!.message, /core\/paragraph cannot hold inner blocks/);
});

test("a child block an image cannot hold is refused rather than dropped", async () => {
  const image = await serializeBlocks([block("core/image", { url: "/a.png" }, [at(block("core/paragraph", {}, [text("x")]), 4)])]);
  assert.deepEqual(image.diagnostics.map((d) => [d.code, d.loc?.line]), [["unmappable_element", 4]]);
});

test("a block with an InnerBlocks slot keeps its children", async () => {
  assert.deepEqual((await serializeBlocks([block("core/group", {}, [block("core/paragraph", {}, [text("x")])])])).diagnostics, []);
});

test("a registered attribute the block's save() does not write is refused rather than lost", async () => {
  const { markup, diagnostics } = await serializeBlocks([at(block("core/list", { values: "<li>LOST</li>" }), 9)]);
  assert.equal(markup, "");
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["attribute_dropped", 9]]);
  assert.match(diagnostics[0]!.message, /core\/list\.values/);
});

test("a registered attribute the save() writes only in part is refused at its block", async () => {
  // core/table writes `scope` for <th> cells only; on a <td> it vanishes.
  const { diagnostics } = await serializeBlocks([at(block("core/table", { body: [{ cells: [{ content: "W", tag: "td", scope: "row" }] }] }), 2)]);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["attribute_dropped", 2]]);
});

test("markup the editor would reject as its block is refused, at the nested block that produced it", async () => {
  const { markup, diagnostics } = await serializeBlocks([block("core/group", {}, [at(block("core/heading", { level: 7, content: "LOST" }), 6)])]);
  assert.equal(markup, "");
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["save_failed", 6]]);
  assert.match(diagnostics[0]!.message, /core\/heading/);
});

test("a value JSON cannot write inside an object attribute is refused before serialization", async () => {
  const { diagnostics } = await serializeBlocks([at(block("core/query", { query: { n: 1n } }), 3)]);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["attribute_type", 3]]);
  assert.match(diagnostics[0]!.message, /BigInt/);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.deepEqual((await serializeBlocks([at(block("core/group", { metadata: circular }), 4)])).diagnostics.map((d) => [d.code, d.loc?.line]), [["attribute_type", 4]]);
});

test("a value JSON would rewrite inside an object attribute is refused rather than changed", async () => {
  for (const metadata of [{ n: Number.NaN }, { n: Number.POSITIVE_INFINITY }, { n: undefined }, { when: new Date(0) }]) {
    const { diagnostics } = await serializeBlocks([at(block("core/group", { metadata }), 5)]);
    assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["attribute_type", 5]], JSON.stringify(Object.keys(metadata)));
    assert.match(diagnostics[0]!.message, /at n|at when/);
  }
});

test("a third-party block's attributes are checked for JSON writability too", async () => {
  const { diagnostics } = await serializeBlocks([at(block("acme/testimonials", { config: { n: 1n } }), 6)]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error").map((d) => [d.code, d.loc?.line]), [["attribute_type", 6]]);
});

test("an unserializable attribute value is still a plain attribute_type error", async () => {
  const big = await serializeBlocks([at(block("core/heading", { level: 1n as unknown as number }), 2)]);
  assert.deepEqual(big.diagnostics.map((d) => [d.code, d.loc?.line]), [["attribute_type", 2]]);
  assert.match(big.diagnostics[0]!.message, /got 1n/);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const loop = await serializeBlocks([at(block("core/heading", { level: circular }), 3)]);
  assert.deepEqual(loop.diagnostics.map((d) => [d.code, d.loc?.line]), [["attribute_type", 3]]);
});

test("a name WordPress would refuse to register is an error, not an empty document", async () => {
  for (const [name, line] of [["Acme/Bad", 1], ["acme", 2], ["acme/Thing_x", 3]] as const) {
    const { markup, diagnostics } = await serializeBlocks([at(block(name), line)]);
    assert.equal(markup, "", name);
    assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["unknown_block", line]], name);
  }
});

test("every problem in a tree is reported in one pass, and nothing is written", async () => {
  const { markup, diagnostics } = await serializeBlocks([
    at(block("core/paragrph"), 1),
    block("core/group", {}, [at(block("core/heading", { levl: 2 }), 2), at(block("core/image", { blob: "x" }), 3)]),
  ]);
  assert.equal(markup, "");
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["unknown_block", 1], ["unknown_attribute", 2], ["local_attribute", 3]]);
});

test("a save() that throws is a located error instead of silent empty markup", async () => {
  await withBlockApi((api) =>
    api.registerBlockType("zero-test/explodes", {
      apiVersion: 3,
      title: "Explodes",
      category: "widgets",
      attributes: { n: { type: "number" } },
      save: () => {
        throw new Error("no save for you");
      },
    }),
  );
  const { markup, diagnostics } = await serializeBlocks([at(block("zero-test/explodes", { n: 1 }), 9)]);
  assert.equal(markup, "");
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error").map(brief), [{ code: "save_failed", severity: "error", file: "/t/page.tsx", line: 9, column: 5 }]);
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
  // The child block is written as real block markup inside the passthrough, so WordPress parses it as an inner block.
  const nested = parsed[1]!.inner[0]!;
  assert.deepEqual([nested.name, nested.attributes.count, nested.attributes.theme, nested.inner.map((i) => [i.name, i.attributes.content])], ["acme/testimonials", 1, "dark", [["core/paragraph", "inside"]]]);
  assert.match(markup, /<!-- wp:acme\/testimonials \{"count":3\} \/-->/);
});

test("the attribute the passthrough keeps its body in cannot be authored", async () => {
  const { diagnostics } = await serializeBlocks([at(block("acme/x", { "zero-blocks:inner-html": "AUTHORED" }, [text("BODY")]), 2)]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error").map((d) => [d.code, d.loc?.line]), [["unknown_attribute", 2]]);
});

test("an empty tree is an empty document", async () => {
  assert.deepEqual(await serializeBlocks([]), { markup: "", diagnostics: [] });
});

test("a second document serializes like the first", async () => {
  const tree = [block("core/paragraph", {}, [text("same")])];
  assert.equal((await serializeBlocks(tree)).markup, (await serializeBlocks(tree)).markup);
});

test("the DOM globals exist only while serializing, and nested calls share one installation", async () => {
  assert.equal("document" in globalThis, false);
  await withBlockApi(async () => {
    assert.equal(typeof (globalThis as Record<string, unknown>).document, "object");
    await serializeBlocks([block("core/paragraph", {}, [text("nested")])]);
    assert.equal(typeof (globalThis as Record<string, unknown>).document, "object");
  });
  assert.equal("document" in globalThis, false);
  assert.equal("window" in globalThis, false);
  await assert.rejects(withBlockApi(() => Promise.reject(new Error("inner"))), /inner/);
  assert.equal("document" in globalThis, false);
  // Two concurrent calls: both see the DOM, and it is gone when both are done.
  await Promise.all([
    withBlockApi(() => assert.equal(typeof (globalThis as Record<string, unknown>).document, "object")),
    withBlockApi(() => assert.equal(typeof (globalThis as Record<string, unknown>).document, "object")),
  ]);
  assert.equal("document" in globalThis, false);
});
