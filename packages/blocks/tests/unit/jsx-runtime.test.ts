import { test } from "node:test";
import assert from "node:assert/strict";

import { Fragment, createElement, jsx, jsxDEV, jsxs, toContentNodes } from "../../src/jsx-runtime.ts";
import { Block, blockComponent } from "../../src/index.ts";
import { ContentError } from "../../src/diagnostics.ts";
import { text } from "./helpers.ts";

test("an HTML tag becomes an element node with its props and normalized children", () => {
  const node = jsxs("p", { class: "lead", children: ["a ", jsx("strong", { children: "b" }), 1, null, false, undefined, [" c"]] });
  assert.deepEqual(node, {
    kind: "element",
    tag: "p",
    props: { class: "lead" },
    children: [text("a "), { kind: "element", tag: "strong", props: {}, children: [text("b")] }, text("1"), text(" c")],
  });
});

test("a component is called, receives its children, and leaves no trace of itself", () => {
  const Card = (props: { title: string; children?: unknown }) => jsxs("section", { class: "card", children: [jsx("h3", { children: props.title }), props.children] });
  const node = jsx(Card, { title: "T", children: jsx("p", { children: "body" }) });
  assert.equal(node.kind, "element");
  assert.equal((node as { tag: string }).tag, "section");
  assert.deepEqual(toContentNodes(node).length, 1);
  assert.deepEqual((node as { children: unknown[] }).children.length, 2);
});

test("a fragment's children splice into the parent, and toContentNodes flattens arrays", () => {
  const node = jsx("div", { children: jsxs(Fragment, { children: [jsx("h1", {}), jsx("p", {})] }) });
  assert.deepEqual((node as { children: { tag: string }[] }).children.map((c) => c.tag), ["h1", "p"]);
  assert.deepEqual(toContentNodes([jsx("p", {}), [jsx("hr", {}), "x"]]).map((n) => (n.kind === "text" ? "text" : (n as { tag: string }).tag)), ["p", "hr", "text"]);
});

test("Block and blockComponent build block nodes: props become attrs, children become inner", () => {
  const Cover = blockComponent<{ url?: string }>("core/cover");
  assert.deepEqual(jsx(Cover, { url: "/a.png", children: "Over" }), { kind: "block", blockName: "core/cover", attrs: { url: "/a.png" }, inner: [text("Over")] });
  assert.deepEqual(jsx(Block, { name: "acme/x", attrs: { n: 1 } }), { kind: "block", blockName: "acme/x", attrs: { n: 1 }, inner: [] });
});

test("jsxDEV attaches the source position to the node, and a component's result inherits the call site", () => {
  const source = { fileName: "/t/a.tsx", lineNumber: 7, columnNumber: 5 };
  const element = jsxDEV("p", { children: "x" }, undefined, false, source);
  assert.deepEqual(element.kind === "element" ? element.loc : null, { file: "/t/a.tsx", line: 7, column: 5 });
  const Cover = blockComponent<{ url?: string }>("core/cover");
  const fromComponent = jsxDEV(Cover, { url: "/a" }, undefined, false, source);
  assert.deepEqual(fromComponent.kind === "block" ? fromComponent.loc : null, { file: "/t/a.tsx", line: 7, column: 5 });
  // A node the component itself located keeps its own, more precise, position and remembers the call site.
  const inner = { fileName: "/t/card.tsx", lineNumber: 2, columnNumber: 3 };
  const Card = () => jsxDEV("section", { children: jsxDEV("p", {}, undefined, false, { ...inner, lineNumber: 3 }) }, undefined, false, inner);
  const fromCard = jsxDEV(Card, {}, undefined, false, source);
  const usedAt = { file: "/t/a.tsx", line: 7, column: 5 };
  assert.deepEqual(fromCard.kind === "element" ? fromCard.loc : null, { file: "/t/card.tsx", line: 2, column: 3, usedAt });
  const child = fromCard.kind === "element" ? fromCard.children[0] : null;
  assert.deepEqual(child?.kind === "element" ? child.loc : null, { file: "/t/card.tsx", line: 3, column: 3, usedAt });
});

test("JSX under a root a component built without JSX still remembers the call site", () => {
  const source = { fileName: "/t/a.tsx", lineNumber: 7, columnNumber: 5 };
  const inner = { fileName: "/t/card.tsx", lineNumber: 3, columnNumber: 3 };
  const Card = () => Block({ name: "acme/card", children: jsxDEV("p", {}, undefined, false, inner) });
  const fromCard = jsxDEV(Card, {}, undefined, false, source);
  const usedAt = { file: "/t/a.tsx", line: 7, column: 5 };
  assert.deepEqual(fromCard.kind === "block" ? fromCard.loc : null, usedAt);
  const child = fromCard.kind === "block" ? fromCard.inner[0] : null;
  assert.deepEqual(child?.kind === "element" ? child.loc : null, { file: "/t/card.tsx", line: 3, column: 3, usedAt });
});

test("a content error thrown while a component's JSX is built names the call site too", () => {
  const source = { fileName: "/t/a.tsx", lineNumber: 7, columnNumber: 5 };
  const inner = { fileName: "/t/card.tsx", lineNumber: 3, columnNumber: 3 };
  const Card = () => jsxDEV("section", { children: new Date(0) }, undefined, false, inner);
  assert.throws(
    () => jsxDEV(Card, {}, undefined, false, source),
    (error: unknown) => error instanceof ContentError && error.code === "not_content" && error.loc !== undefined && error.loc.line === 3 && error.loc.usedAt?.line === 7,
  );
});

test("a key that stays in props after a spread is ignored, as a lifted key is", () => {
  const element = jsx("p", { ...{ key: "row-1", class: "lead" }, children: "x" });
  assert.deepEqual(element, { kind: "element", tag: "p", props: { class: "lead" }, children: [text("x")] });
  const Paragraph = blockComponent<{ class?: string }>("core/paragraph");
  const fromComponent = jsx(Paragraph, { ...{ key: "row-1" }, children: "x" });
  assert.deepEqual(fromComponent.kind === "block" ? fromComponent.attrs : null, {});
});

test("a node without a position of its own takes the position of the element it sits in", () => {
  const source = { fileName: "/t/a.tsx", lineNumber: 4, columnNumber: 5 };
  const section = jsxDEV("section", { children: createElement("p", { style: "x" }, "Hello") }, undefined, false, source);
  const child = section.kind === "element" ? section.children[0] : null;
  assert.deepEqual(child?.kind === "element" ? child.loc : null, { file: "/t/a.tsx", line: 4, column: 5 });
});

test("an unlocated node nested under another unlocated node inherits the same position", () => {
  const source = { fileName: "/t/a.tsx", lineNumber: 4, columnNumber: 5 };
  const section = jsxDEV("section", { children: createElement("div", null, createElement("p", { style: "x" }, "Hello")) }, undefined, false, source);
  const div = section.kind === "element" ? section.children[0] : null;
  const p = div?.kind === "element" ? div.children[0] : null;
  assert.deepEqual(p?.kind === "element" ? p.loc : null, { file: "/t/a.tsx", line: 4, column: 5 });
});

test("an error with no position of its own keeps the call site aside rather than taking it as its position", () => {
  const source = { fileName: "/t/a.tsx", lineNumber: 7, columnNumber: 5 };
  const Card = () => createElement("p", null, new Date(0));
  assert.throws(
    () => jsxDEV(Card, {}, undefined, false, source),
    (error: unknown) => error instanceof ContentError && error.code === "not_content" && error.loc === undefined && error.calledFrom?.line === 7,
  );
});

test("the same error thrown from two call sites names each call site, not the first", () => {
  let cached: unknown;
  const Card = () => {
    try {
      return createElement("p", null, new Date(0));
    } catch (error) {
      cached ??= error;
      throw cached;
    }
  };
  const at = (line: number) => ({ fileName: "/page.tsx", lineNumber: line, columnNumber: 3 });
  const calledFrom = (line: number) => {
    try {
      jsxDEV(Card, {}, undefined, false, at(line));
    } catch (error) {
      return (error as ContentError).calledFrom?.line;
    }
    return undefined;
  };
  assert.deepEqual([calledFrom(7), calledFrom(19)], [7, 19]);
});

test("the classic transform's createElement builds the same node as jsx", () => {
  assert.deepEqual(createElement("p", { class: "lead" }, "a", jsx("em", { children: "b" })), jsx("p", { class: "lead", children: ["a", jsx("em", { children: "b" })] }));
  assert.deepEqual(createElement("hr", null), jsx("hr", {}));
});

test("a hole in a returned node's children is refused as not content", () => {
  assert.throws(() => toContentNodes({ kind: "element", tag: "p", props: {}, children: Array(1) }), (e: unknown) => e instanceof ContentError && e.code === "not_content");
  assert.throws(() => toContentNodes({ kind: "block", blockName: "core/group", attrs: {}, inner: Array(2) }), (e: unknown) => e instanceof ContentError && e.code === "not_content");
});

test("a malformed node anywhere in a returned tree is refused as not content", () => {
  assert.throws(() => toContentNodes({ kind: "element", tag: "p", props: {}, children: [{ kind: "text" }] }), (e: unknown) => e instanceof ContentError && e.code === "not_content");
  assert.throws(() => toContentNodes({ kind: "block", blockName: "core/group", attrs: {}, inner: [null] }), (e: unknown) => e instanceof ContentError && e.code === "not_content");
});

test("a value that is not content is refused at the element that holds it", () => {
  const source = { fileName: "/t/a.tsx", lineNumber: 3, columnNumber: 9 };
  assert.throws(
    () => jsxDEV("section", { children: new Date(0) }, undefined, false, source),
    (error: unknown) => error instanceof ContentError && error.code === "not_content" && error.loc?.line === 3 && /Date/.test(error.message),
  );
});

test("a value that is not a tag, a component or a fragment is refused as an element type", () => {
  assert.throws(() => jsx(42 as unknown as string, {}), (error: unknown) => error instanceof ContentError && error.code === "not_content");
});
