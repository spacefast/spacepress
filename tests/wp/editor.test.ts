// Editor parity (§1.7, §4.3, §4.9): saves through core /wp/v2/zero_posts with `acf` fields, the way the
// block editor saves, show up in /zero/v1 in the same request with Zero's decoded values; Zero's rules
// block bad values with Zero's message; afterCreate/afterUpdate run with the editing user. The test
// app's posts hooks (tests/wp/app) record each run as a comment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { core, http, ok, problem, run, sql, wp } from "./env.ts";

test("a core REST save with acf fields reads back identically through /zero/v1 and runs the after hooks", async () => {
  const created = await http("POST", core + "/zero_posts", {
    as: "editor",
    body: {
      title: `Audit ${run}`,
      status: "publish",
      content: "<p>From the editor</p>",
      acf: { zero_excerpt: "Core excerpt", zero_tags: ["guide", "news"], zero_seo: { metaTitle: "SEO" } },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id;

  const row = await ok("GET", `/posts/${id}?with=comments`, { as: "editor" });
  assert.deepEqual(
    { title: row.title, body: row.body, excerpt: row.excerpt, tags: row.tags, seo: row.seo, status: row.status, slug: row.slug },
    { title: `Audit ${run}`, body: "<p>From the editor</p>", excerpt: "Core excerpt", tags: ["guide", "news"],
      seo: { metaTitle: "SEO", metaDescription: null, noindex: false }, status: "published", slug: `audit-${run}` },
  );
  assert.match(row.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/, "defaults Zero generates are filled on editor saves");
  assert.deepEqual(row.comments.map((c: any) => [c.name, c.body]), [["afterCreate", "by Editor"]]);

  const updated = await http("POST", `${core}/zero_posts/${id}`, { as: "editor", body: { title: `Audit ${run} v2`, acf: { zero_excerpt: "Edited in core" } } });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  const after = await ok("GET", `/posts/${id}?with=comments`, { as: "editor" });
  assert.equal(after.excerpt, "Edited in core");
  assert.deepEqual(after.comments.map((c: any) => [c.name, c.body]), [
    ["afterCreate", "by Editor"],
    ["afterUpdate", `Audit ${run} -> Audit ${run} v2`],
  ]);

  // A core-side status change needs no sync: the next read sees it.
  wp("post", "update", String(id), "--post_status=draft");
  assert.equal((await ok("GET", `/posts/${id}`, { as: "editor" })).status, "draft");
});

test("Zero's rules block an editor save with Zero's message", async () => {
  const before = sql("SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'zero_posts'")[0].n;
  const tooLong = await http("POST", core + "/zero_posts", { as: "editor", body: { title: `Long ${run}`, status: "publish", acf: { zero_excerpt: "x".repeat(301) } } });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.json.data.params.acf, "excerpt must be at most 300 characters");
  // The same message /zero/v1 gives for the same value.
  const viaZero = await problem("POST", "/posts", { as: "editor", body: { title: `Long ${run}`, excerpt: "x".repeat(301) } }, { status: 422, code: "invalid_input", pointer: "/excerpt" });
  assert.equal(viaZero.detail, tooLong.json.data.params.acf);
  const nested = await http("POST", core + "/zero_posts", {
    as: "editor",
    body: { title: `Nested ${run}`, status: "publish", acf: { zero_sections: [{ acf_fc_layout: "hero", heading: "x".repeat(81) }] } },
  });
  assert.equal(nested.status, 400);
  assert.equal(nested.json.data.params.acf, "heading must be at most 80 characters");
  assert.equal(sql("SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'zero_posts'")[0].n, before, "nothing was saved");
  // wp-admin's form save validates through acf_validate_value: same message.
  const form = JSON.parse(wp("eval", `acf_validate_value(str_repeat('x', 301), acf_get_field('field_zero_posts_excerpt'), 'acf[field_zero_posts_excerpt]'); echo wp_json_encode(acf_get_validation_errors());`));
  assert.deepEqual(form, [{ input: "acf[field_zero_posts_excerpt]", message: "excerpt must be at most 300 characters" }]);
});
