import { test } from "node:test";
import assert from "node:assert/strict";

import { ExcerptError, excerpt } from "../../src/lib/excerpt.ts";

const text = ["a", "  export const x = {", "    one: 1,", "  };", "  export const y = {", "  };", ""].join("\n");

test("the excerpt runs from the line with `from` through the next line with `to`, dedented", () => {
  assert.equal(excerpt(text, { from: "const x", to: "};" }), "export const x = {\n  one: 1,\n};");
});

test("an anchor that matches no line or more than one fails", () => {
  assert.throws(() => excerpt(text, { from: "const z", to: "};" }), ExcerptError);
  assert.throws(() => excerpt(text, { from: "export const", to: "};" }), ExcerptError);
});

test("`to` must come after `from`", () => {
  assert.throws(() => excerpt(text, { from: "const y", to: "one: 1" }), ExcerptError);
});

test("`toLine` ends at a line that is exactly that text, so an inner `}` does not cut a block short", () => {
  const block = ["function f() {", "    if (a) {", "        b();", "    }", "    c();", "}", ""].join("\n");
  assert.equal(excerpt(block, { from: "function f", toLine: "}" }), block.trimEnd());
  assert.equal(excerpt(block, { from: "function f", to: "}" }), "function f() {\n    if (a) {\n        b();\n    }");
});

test("an excerpt needs exactly one end anchor", () => {
  assert.throws(() => excerpt("a\nb", { from: "a" }), ExcerptError);
  assert.throws(() => excerpt("a\nb", { from: "a", to: "b", toLine: "b" }), ExcerptError);
});
