import { test } from "node:test";
import assert from "node:assert/strict";

import { Fragment, jsx, jsxDEV, jsxs, toContentNodes } from "../../src/jsx-runtime.ts";
import { mapToBlocks, renderRichTextHtml } from "../../src/mapping.ts";
import type { ContentNode } from "../../src/nodes.ts";
import { blockAt, brief, names, text } from "./helpers.ts";

const map = (rendered: unknown) => mapToBlocks(toContentNodes(rendered));

test("a heading carries its level, class and anchor", () => {
  const { blocks, diagnostics } = map(jsx("h2", { class: "tight", id: "pricing", children: "Plans" }));
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(blocks[0], { kind: "block", blockName: "core/heading", attrs: { level: 2, className: "tight", anchor: "pricing" }, inner: [text("Plans")] });
});

test("a paragraph keeps phrasing content as rich text", () => {
  const { blocks, diagnostics } = map(jsxs("p", { children: ["a ", jsx("strong", { children: "b" }), " c"] }));
  assert.deepEqual(diagnostics, []);
  assert.equal(blocks[0]?.blockName, "core/paragraph");
  assert.equal(renderRichTextHtml(blocks[0]!.inner), "a <strong>b</strong> c");
});

test("text given to a line break is refused rather than dropped", () => {
  const { diagnostics } = map(jsxs("p", { children: ["before", jsx("br", { children: "LOST" }), "after"] }));
  assert.deepEqual(diagnostics.map((d) => [d.code, d.severity]), [["unmappable_element", "error"]]);
  assert.match(diagnostics[0]!.message, /Text inside a <br>/);
});

test("rich text escapes what would otherwise be markup, and className becomes class", () => {
  assert.equal(renderRichTextHtml(toContentNodes(["5 < 6 & ", jsx("em", { className: "x", children: '"q"' }), jsx("br", {})])), '5 &lt; 6 &amp; <em class="x">&quot;q&quot;</em><br>');
});

test("an inline boolean value is written as text unless the attribute is an HTML boolean", () => {
  assert.equal(renderRichTextHtml(toContentNodes(jsx("span", { role: "checkbox", "aria-checked": false, draggable: false, children: "c" }))), '<span role="checkbox" aria-checked="false" draggable="false">c</span>');
  assert.equal(renderRichTextHtml(toContentNodes(jsx("span", { hidden: true, children: "h" }))), "<span hidden>h</span>");
  assert.equal(renderRichTextHtml(toContentNodes(jsx("span", { hidden: false, children: "h" }))), "<span>h</span>");
});

test("lists: ordered flag, items as inner blocks, a nested list beside its item's text", () => {
  const { blocks } = map(jsxs("ol", { children: [jsx("li", { children: "one" }), jsxs("li", { children: ["two", jsx("ul", { children: jsx("li", { children: "child" }) })] })] }));
  assert.deepEqual(blocks[0]?.attrs, { ordered: true });
  assert.deepEqual(names(blocks[0]!.inner), ["core/list-item", "core/list-item"]);
  const second = blockAt(blocks[0]!.inner, 1);
  assert.deepEqual(names(second.inner), ["<text>", "core/list"]);
  assert.deepEqual(map(jsx("ul", { children: jsx("li", {}) })).blocks[0]?.attrs, {});
});

test("an ordered list's start and reversed reach the list block", () => {
  const { blocks, diagnostics } = map(jsx("ol", { start: "5", reversed: "", children: jsx("li", { children: "e" }) }));
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(blocks[0]?.attrs, { ordered: true, start: 5, reversed: true });
});

test("HTML's list types become the CSS list styles the list block stores", () => {
  const styles = ["1", "a", "A", "i", "I"].map((type) => map(jsx("ol", { type, children: jsx("li", {}) })).blocks[0]?.attrs.type);
  assert.deepEqual(styles, ["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"]);
});

test("a list type outside HTML's vocabulary is refused", () => {
  const { diagnostics } = map(jsx("ol", { type: "lower-greek", children: jsx("li", {}) }));
  assert.deepEqual(diagnostics.map((d) => d.code), ["unmappable_element"]);
  assert.match(diagnostics[0]!.message, /"type" prop/);
});

test("a prop with a value of the wrong kind is refused rather than dropped", () => {
  const at = (line: number) => ({ fileName: "/t/page.tsx", lineNumber: line, columnNumber: 1 });
  const { blocks, diagnostics } = map([
    jsxDEV("ol", { start: "five", children: jsx("li", {}) }, undefined, false, at(1)),
    jsxDEV("details", { open: "yes", children: jsx("summary", { children: "S" }) }, undefined, false, at(2)),
    jsxDEV("p", { id: { a: 1 }, children: "x" }, undefined, false, at(3)),
  ]);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["unmappable_element", 1], ["unmappable_element", 2], ["unmappable_element", 3]]);
  assert.deepEqual(blocks.map((b) => b.attrs), [{ ordered: true }, { summary: "S" }, {}]);
});

test("a numeric id is the anchor as text", () => {
  const { blocks, diagnostics } = map(jsx("p", { id: 123, children: "x" }));
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(blocks[0]?.attrs, { anchor: "123" });
});

test("an empty open attribute means open, as it does in HTML", () => {
  const { blocks, diagnostics } = map(jsxs("details", { open: "", children: [jsx("summary", { children: "S" }), jsx("p", { children: "b" })] }));
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(blocks[0]?.attrs, { showContent: true, summary: "S" });
});

test("text after a nested list in an item is refused rather than moved in front of the list", () => {
  const at = { fileName: "/t/page.tsx", lineNumber: 4, columnNumber: 3 };
  const { diagnostics } = map(jsx("ul", { children: jsxDEV("li", { children: ["before", jsx("ul", { children: jsx("li", { children: "nested" }) }), "AFTER"] }, undefined, false, at) }));
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["unmappable_element", 4]]);
  assert.match(diagnostics[0]!.message, /after a nested list/);
});

test("a prop the tag's block has no attribute for is refused rather than dropped", () => {
  const at = (line: number) => ({ fileName: "/t/page.tsx", lineNumber: line, columnNumber: 1 });
  const { diagnostics } = map([
    jsxDEV("p", { "data-track": "hero", children: "x" }, undefined, false, at(1)),
    jsxDEV("img", { src: "/a.png", loading: "lazy" }, undefined, false, at(2)),
    jsx("table", { children: jsx("tr", { children: jsxDEV("td", { headers: "h1", children: "c" }, undefined, false, at(3)) }) }),
    jsx("pre", { children: jsxDEV("code", { class: "language-ts", children: "c" }, undefined, false, at(4)) }),
  ]);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["unmappable_element", 1], ["unmappable_element", 2], ["unmappable_element", 3], ["unmappable_element", 4]]);
  assert.match(diagnostics[0]!.message, /"data-track" prop/);
  assert.match(diagnostics[3]!.hint ?? "", /class on the <pre>/);
});

test("an image's title, width and height reach the image block, bare pixels as CSS lengths", () => {
  const { blocks, diagnostics } = map(jsx("img", { src: "/a.png", title: "T", width: 300, height: "20" }));
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(blocks[0]?.attrs, { url: "/a.png", title: "T", width: "300px", height: "20px" });
  assert.equal(map(jsx("img", { src: "/a.png", width: "50%" })).blocks[0]?.attrs.width, "50%");
});

test("a table cell's colSpan, rowSpan and scope are kept on the cell", () => {
  const { blocks, diagnostics } = map(jsx("table", { children: jsx("tr", { children: [jsx("th", { scope: "col", colSpan: 2, children: "W" }), jsx("td", { rowspan: "3", children: "x" })] }) }));
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(blocks[0]?.attrs.body, [{ cells: [{ content: "W", tag: "th", colspan: "2", scope: "col" }, { content: "x", tag: "td", rowspan: "3" }] }]);
});

test("an open details with a name keeps both on the block", () => {
  const { blocks, diagnostics } = map(jsxs("details", { open: true, name: "faq", children: [jsx("summary", { children: "S" }), jsx("p", { children: "b" })] }));
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(blocks[0]?.attrs, { showContent: true, name: "faq", summary: "S" });
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

test("a figure with an image and caption is one image block", () => {
  const { blocks, diagnostics } = map(jsxs("figure", { children: [jsx("img", { src: "/a.png", alt: "A" }), jsx("figcaption", { children: ["cap ", jsx("em", { children: "x" })] })] }));
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(blocks, [{ kind: "block", blockName: "core/image", attrs: { url: "/a.png", alt: "A", caption: "cap <em>x</em>" }, inner: [] }]);
});

test("a figure without an image is refused", () => {
  const empty = map(jsx("figure", { children: jsx("p", { children: "no image" }) }));
  assert.deepEqual([empty.blocks, empty.diagnostics.map((d) => d.code)], [[], ["unmappable_element"]]);
});

test("a class or id on both a figure and its img is a collision, not a silent overwrite", () => {
  const at = { fileName: "/t/page.tsx", lineNumber: 2, columnNumber: 3 };
  const { diagnostics } = map(jsx("figure", { class: "outer", id: "outer", children: jsxDEV("img", { src: "/a.png", class: "inner", id: "inner" }, undefined, false, at) }));
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["unmappable_element", 2], ["unmappable_element", 2]]);
  assert.match(diagnostics[0]!.message, /"class"/);
  assert.match(diagnostics[1]!.message, /"id"/);
});

test("a class on the img alone reaches the image block", () => {
  const { blocks, diagnostics } = map(jsx("figure", { children: jsx("img", { src: "/a.png", class: "inner" }) }));
  assert.deepEqual(diagnostics, []);
  assert.equal(blocks[0]?.attrs.className, "inner");
});

test("a quote holds blocks, and loose text inside one becomes a paragraph", () => {
  const { blocks } = map(jsx("blockquote", { children: "loose" }));
  assert.deepEqual([blocks[0]?.blockName, names(blocks[0]!.inner)], ["core/quote", ["core/paragraph"]]);
});

test("details keeps its summary as an attribute and its body as blocks", () => {
  const { blocks } = map(jsxs("details", { children: [jsx("summary", { children: "More" }), jsx("p", { children: "body" })] }));
  assert.deepEqual([blocks[0]?.attrs, names(blocks[0]!.inner)], [{ summary: "More" }, ["core/paragraph"]]);
});

test("pre wrapping code is a code block holding the code's text; a bare pre is still code", () => {
  assert.deepEqual(map(jsx("pre", { children: jsx("code", { children: "a < b" }) })).blocks, [{ kind: "block", blockName: "core/code", attrs: {}, inner: [text("a < b")] }]);
  assert.deepEqual(map(jsx("pre", { children: "bare" })).blocks[0]?.inner, [text("bare")]);
});

test("a table becomes head, body and foot cell attributes, not inner blocks; rows without a tbody are body rows", () => {
  const { blocks } = map(jsxs("table", { children: [jsx("thead", { children: jsx("tr", { children: jsx("th", { children: "Plan" }) }) }), jsx("tbody", { children: jsx("tr", { children: jsx("td", { children: "Free" }) }) })] }));
  assert.deepEqual([blocks[0]?.attrs, blocks[0]?.inner], [{ head: [{ cells: [{ content: "Plan", tag: "th" }] }], body: [{ cells: [{ content: "Free", tag: "td" }] }], foot: [] }, []]);
  const bare = map(jsx("table", { children: jsx("tr", { children: jsx("td", { children: "x" }) }) }));
  assert.deepEqual(bare.blocks[0]?.attrs.body, [{ cells: [{ content: "x", tag: "td" }] }]);
});

test("a horizontal rule is a separator", () => {
  assert.deepEqual(map(jsx("hr", {})).blocks, [{ kind: "block", blockName: "core/separator", attrs: {}, inner: [] }]);
});

test("structural children (figcaption, summary, table sections, rows) are checked for style props too", () => {
  const at = (line: number) => ({ fileName: "/t/page.tsx", lineNumber: line, columnNumber: 1 });
  const { diagnostics } = map([
    jsxs("figure", { children: [jsx("img", { src: "/a.png" }), jsxDEV("figcaption", { style: "x", children: "c" }, undefined, false, at(1))] }),
    jsx("details", { children: jsxDEV("summary", { style: "x", children: "s" }, undefined, false, at(2)) }),
    jsx("table", { children: jsxDEV("tbody", { style: "x", children: jsxDEV("tr", { style: "x", children: jsx("td", { children: "c" }) }, undefined, false, at(4)) }, undefined, false, at(3)) }),
  ]);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["style_prop_unsupported", 1], ["style_prop_unsupported", 2], ["style_prop_unsupported", 3], ["style_prop_unsupported", 4]]);
});

test("an image or a rule with children, and a second summary, are refused rather than dropped", () => {
  const at = (line: number) => ({ fileName: "/t/page.tsx", lineNumber: line, columnNumber: 1 });
  const { diagnostics } = map([
    jsx("img", { src: "/a.png", children: jsxDEV("span", { children: "lost" }, undefined, false, at(1)) }),
    jsx("figure", { children: jsx("img", { src: "/a.png", children: jsxDEV("b", {}, undefined, false, at(2)) }) }),
    jsx("hr", { children: jsxDEV("em", {}, undefined, false, at(3)) }),
    jsxs("details", { children: [jsx("summary", { children: "one" }), jsxDEV("summary", { style: "x", children: "two" }, undefined, false, at(4)), jsx("p", { children: "body" })] }),
  ]);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [["unmappable_element", 1], ["unmappable_element", 2], ["unmappable_element", 3], ["unmappable_element", 4]]);
});

test("every table section of a kind contributes its rows, and loose rows are body rows in document order", () => {
  const row = (cell: string) => jsx("tr", { children: jsx("td", { children: cell }) });
  const { blocks, diagnostics } = map(jsxs("table", { children: [row("first"), jsx("tbody", { children: row("a") }), row("loose"), jsx("tbody", { children: row("b") }), jsx("tfoot", { children: row("f") })] }));
  assert.deepEqual(diagnostics, []);
  type Rows = { cells: { content: string }[] }[];
  assert.deepEqual((blocks[0]!.attrs.body as Rows).map((r) => r.cells[0]!.content), ["first", "a", "loose", "b"]);
  assert.deepEqual((blocks[0]!.attrs.foot as Rows).map((r) => r.cells[0]!.content), ["f"]);
});

test("a child that a construct has no place for is refused rather than dropped", () => {
  const at = (line: number) => ({ fileName: "/t/page.tsx", lineNumber: line, columnNumber: 1 });
  const { diagnostics } = map([
    jsxs("pre", { children: [jsx("code", { children: "A" }), "B", jsxDEV("span", { children: "C" }, undefined, false, at(1))] }),
    jsxs("figure", { children: [jsx("img", { src: "/a.png" }), jsxDEV("p", { children: "stray" }, undefined, false, at(2))] }),
    jsxs("table", { children: [jsxDEV("caption", { children: "cap" }, undefined, false, at(3)), jsx("tbody", { children: [jsx("tr", { children: [jsx("td", { children: "c" }), jsxDEV("div", {}, undefined, false, at(4))] }), jsxDEV("p", {}, undefined, false, at(5))] })] }),
  ]);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line ?? "pre"]), [
    ["unmappable_element", "pre"],
    ["unmappable_element", 1],
    ["unmappable_element", 2],
    ["unmappable_element", 3],
    ["unmappable_element", 5],
    ["unmappable_element", 4],
  ]);
  assert.match(diagnostics[0]!.message, /Text inside a <pre>/);
});

test("every element in a tree is checked: a style prop or a block-level tag deep inside rich text is reported", () => {
  const at = (line: number) => ({ fileName: "/t/page.tsx", lineNumber: line, columnNumber: 1 });
  const { diagnostics } = map([
    jsx("p", { children: jsx("strong", { children: jsxDEV("em", { style: "x", children: "deep" }, undefined, false, at(1)) }) }),
    jsx("figure", { children: jsxDEV("img", { src: "/a.png", style: "x" }, undefined, false, at(2)) }),
    jsx("p", { children: jsxDEV("marquee", { children: "no" }, undefined, false, at(3)) }),
    jsx("ul", { children: jsx("li", { children: jsxDEV("span", { style: "x", children: "item" }, undefined, false, at(4)) }) }),
    jsx("table", { children: jsx("tr", { children: jsxDEV("td", { style: "x", children: "cell" }, undefined, false, at(5)) }) }),
    jsx("details", { children: jsx("summary", { children: jsxDEV("b", { style: "x" }, undefined, false, at(6)) }) }),
    { kind: "block", blockName: "core/cover", attrs: {}, inner: toContentNodes(jsxDEV("em", { style: "x", children: "cap" }, undefined, false, at(7))) },
    jsx("pre", { children: jsx("code", { children: jsxDEV("i", { style: "x" }, undefined, false, at(8)) }) }),
    jsxDEV("em", { style: "x", children: "block-level inline" }, undefined, false, at(9)),
  ]);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.loc?.line]), [
    ["style_prop_unsupported", 1],
    ["style_prop_unsupported", 2],
    ["unmappable_element", 3],
    ["style_prop_unsupported", 4],
    ["style_prop_unsupported", 5],
    ["style_prop_unsupported", 6],
    ["style_prop_unsupported", 7],
    ["style_prop_unsupported", 8],
    ["style_prop_unsupported", 9],
  ]);
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
    { code: "style_prop_unsupported", severity: "error", file: "/t/page.tsx", line: 4, column: 5 },
    { code: "unmappable_element", severity: "error", file: "/t/page.tsx", line: 5, column: 7 },
    { code: "style_prop_unsupported", severity: "error", file: "/t/page.tsx", line: 8, column: 9 },
  ]);
  assert.match(diagnostics[0]!.hint ?? "", /class/);
  assert.match(diagnostics[1]!.hint ?? "", /Block name/);
  assert.deepEqual(names(blocks), ["core/paragraph", "core/paragraph"]);
});
