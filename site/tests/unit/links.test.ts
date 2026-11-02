import { test } from "node:test";
import assert from "node:assert/strict";

import { rewrite } from "../../src/lib/links.ts";

const fromDoc = { base: "/z", from: "docs/config-api.md" };
const fromReadme = { base: "/z", from: "README.md" };

test("a link to another doc goes to its page, keeping its anchor", () => {
  assert.equal(rewrite("wp-plugins.md", fromDoc), "/z/docs/wp-plugins");
  assert.equal(rewrite("docs/wp-plugins.md#locks", fromReadme), "/z/docs/wp-plugins#locks");
});

test("a link to a repository file goes to GitHub", () => {
  assert.equal(rewrite("../examples/recipes/seo.ts", fromDoc), "https://github.com/spacefast/zero/blob/main/examples/recipes/seo.ts");
  assert.equal(rewrite("LICENSE", fromReadme), "https://github.com/spacefast/zero/blob/main/LICENSE");
  assert.equal(rewrite("examples/blog", fromReadme), "https://github.com/spacefast/zero/blob/main/examples/blog");
});

test("design records are not pages of the site", () => {
  assert.equal(rewrite("design-wp-only.md", fromDoc), "https://github.com/spacefast/zero/blob/main/docs/design-wp-only.md");
});

test("absolute URLs and in-page anchors are left alone", () => {
  assert.equal(rewrite("https://astro.build", fromDoc), "https://astro.build");
  assert.equal(rewrite("#access", fromDoc), "#access");
});
