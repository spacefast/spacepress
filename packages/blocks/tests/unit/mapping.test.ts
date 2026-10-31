import { test } from "node:test";
import assert from "node:assert/strict";

import { Fragment, jsx, jsxDEV, jsxs, toContentNodes } from "../../src/jsx-runtime.ts";
import { mapToBlocks, renderRichTextHtml } from "../../src/mapping.ts";
import type { ContentNode } from "../../src/nodes.ts";
import { blockAt, brief, names, text } from "./helpers.ts";

const map = (rendered: unknown) => mapToBlocks(toContentNodes(rendered));

test("a heading carries its level, class and anchor; a paragraph keeps phrasing content as rich text", () => {
  const { blocks, diagnostics } = map([
    jsx("h2", { class: "tight", id: "pricing", children: "Plans" }),
    jsxs("p", { children: ["a ", jsx("strong", { children: "b" }), " c"] }),
  ]);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(blocks[0], { kind: "block", blockName: "core/heading", attrs: { level: 2, className: "tight", anchor: "pricing" }, inner: [text("Plans")] });
  assert.equal(blocks[1]?.blockName, "core/paragraph");
  assert.equal(renderRichTextHtml(blocks[1]!.inner), "a <strong>b</strong> c");
});

test("rich text escapes what would otherwise be markup, and className becomes class", () => {
  assert.equal(renderRichTextHtml(toContentNodes(["5 < 6 & ", jsx("em", { className: "x", children: '"q"' }), jsx("br", {})])), '5 &lt; 6 &amp; <em class="x">&quot;q&quot;</em><br>');
});

test("lists: ordered flag, items as inner blocks, a nested list beside its item's text", () => {
  const { blocks } = map(jsxs("ol", { children: [jsx("li", { children: "one" }), jsxs("li", { children: ["two", jsx("ul", { children: jsx("li", { children: "child" }) })] })] }));
  assert.deepEqual(blocks[0]?.attrs, { ordered: true });
  assert.deepEqual(names(blocks[0]!.inner), ["core/list-item", "core/list-item"]);
  const second = blockAt(blocks[0]!.inner, 1);
  assert.deepEqual(names(second.inner), ["<text>", "core/list"]);
  assert.deepEqual(map(jsx("ul", { children: jsx("li", {}) })).blocks[0]?.attrs, {});
});

test("sectioning tags are groups that remember their tag; a bare div dissolves and a classed div is a group", () => {
  const { blocks } = map([
    jsx("section", { class: "card", children: jsx("p", { children: "in" }) }),
    jsx("div", { children: jsxs(Fragment, { children: [jsx("h1", {}), jsx("p", {})] }) }),
    jsx("div", { class: "flex gap-4", children: [jsx("div", { class: "w-1/2" }), jsx("div", { class: "w-1/2" })] }),
  ]);
  assert.deepEqual(blocks[0], { kind: "block", blockName: "core/group", attrs: { tagName: "section", className: "card" }, inner: [{ kind: "block", blockName: "core/paragraph", attrs: {}, inner: [text("in")] }] });
  assert.deepEqual(names(blocks).slice(1), ["core/heading", "core/paragraph", "core/group"]);
  // Layout classes pass through; nothing is inferred into columns.
  assert.deepEqual(names(blocks[3]!.inner), ["core/group", "core/group"]);
  assert.equal(blocks[3]?.attrs.tagName, undefined);
});

test("figure, quote, details, pre, table and hr map to their blocks", () => {
  const { blocks, diagnostics } = map([
    jsxs("figure", { children: [jsx("img", { src: "/a.png", alt: "A" }), jsx("figcaption", { children: "cap" })] }),
    jsx("blockquote", { children: "loose" }),
    jsxs("details", { children: [jsx("summary", { children: "More" }), jsx("p", { children: "body" })] }),
    jsx("pre", { children: jsx("code", { children: "a < b" }) }),
    jsxs("table", { children: [jsx("thead", { children: jsx("tr", { children: jsx("th", { children: "Plan" }) }) }), jsx("tbody", { children: jsx("tr", { children: jsx("td", { children: "Free" }) }) })] }),
    jsx("hr", {}),
  ]);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(blocks[0], { kind: "block", blockName: "core/image", attrs: { url: "/a.png", alt: "A", caption: "cap" }, inner: [] });
  assert.deepEqual([blocks[1]?.blockName, names(blocks[1]!.inner)], ["core/quote", ["core/paragraph"]]);
  assert.deepEqual([blocks[2]?.attrs, names(blocks[2]!.inner)], [{ summary: "More" }, ["core/paragraph"]]);
  assert.deepEqual(blocks[3], { kind: "block", blockName: "core/code", attrs: {}, inner: [text("a < b")] });
  assert.deepEqual(blocks[4]?.attrs, { head: [{ cells: [{ content: "Plan", tag: "th" }] }], body: [{ cells: [{ content: "Free", tag: "td" }] }], foot: [] });
  assert.equal(blocks[5]?.blockName, "core/separator");
});

test("loose text at block level becomes a paragraph; whitespace-only runs vanish", () => {
  const { blocks } = map(jsxs(Fragment, { children: ["Just a sentence.", jsx("hr", {}), "   "] }));
  assert.deepEqual(names(blocks), ["core/paragraph", "core/separator"]);
  assert.deepEqual(blocks[0]?.inner, [text("Just a sentence.")]);
});

test("an authored block keeps its attrs and has its inner JSX mapped; rich text given to it stays rich text", () => {
  const cover: ContentNode = { kind: "block", blockName: "core/cover", attrs: { url: "/bg.png" }, inner: toContentNodes(jsx("h2", { children: "Over" })) };
  const caption: ContentNode = { kind: "block", blockName: "core/cover", attrs: {}, inner: toContentNodes(["plain ", jsx("em", { children: "text" })]) };
  const { blocks } = map([cover, caption]);
  assert.deepEqual([blocks[0]?.attrs, names(blocks[0]!.inner)], [{ url: "/bg.png" }, ["core/heading"]]);
  assert.deepEqual(names(blocks[1]!.inner), ["<text>", "<element>"]);
});

test("a style prop and an unmappable tag are located errors, and mapping continues past them", () => {
  const at = (line: number, column: number) => ({ fileName: "/t/page.tsx", lineNumber: line, columnNumber: column });
  const { blocks, diagnostics } = map([
    jsx("p", { children: "kept" }),
    jsxDEV("div", { style: { color: "red" }, children: jsxDEV("marquee", {}, undefined, false, at(5, 7)) }, undefined, false, at(4, 5)),
    jsxDEV("p", { children: jsxDEV("em", { style: "color:red", children: "x" }, undefined, false, at(8, 9)) }, undefined, false, at(8, 5)),
  ]);
  assert.deepEqual(diagnostics.map(brief), [
    { code: "style_prop_unsupported", severity: "error", file: "page.tsx", line: 4, column: 5 },
    { code: "unmappable_element", severity: "error", file: "page.tsx", line: 5, column: 7 },
    { code: "style_prop_unsupported", severity: "error", file: "page.tsx", line: 8, column: 9 },
  ]);
  assert.match(diagnostics[0]!.hint ?? "", /class/);
  assert.match(diagnostics[1]!.hint ?? "", /Block name/);
  assert.deepEqual(names(blocks), ["core/paragraph", "core/paragraph"]);
});
