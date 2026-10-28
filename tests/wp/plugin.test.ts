// Plugin activation (§4.1, §4.2, §4.5, §4.9, §5.1): what activating the built plugin leaves in a real
// WordPress, read back through WP-CLI and SQL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, sql, wp } from "./env.ts";

test("activation registers the post types, field groups and options page, and creates InnoDB tables", () => {
  assert.equal(wp("plugin", "get", harness.plugin, "--field=status"), "active");

  const types = JSON.parse(wp("post-type", "list", "--format=json", "--fields=name,public,show_in_rest,rest_base"));
  assert.deepEqual(
    types.filter((t: any) => t.name.startsWith("zero_")).map((t: any) => [t.name, t.public, t.show_in_rest, t.rest_base]),
    [["zero_authors", false, true, "zero_authors"], ["zero_posts", false, true, "zero_posts"], ["zero_events", false, true, "zero_events"]],
  );

  const scf = JSON.parse(wp("eval", `echo wp_json_encode([
    'groups' => array_map(fn ($g) => [$g['key'], $g['location'][0][0]['value'], array_column(acf_get_fields($g['key']), 'name', 'key')], acf_get_field_groups()),
    'pages' => array_map(fn ($p) => [$p['menu_slug'], $p['post_id'], $p['parent_slug']], array_values(acf_get_options_pages() ?: [])),
  ]);`));
  const posts = scf.groups.find((g: any) => g[0] === "group_zero_posts");
  assert.equal(posts[1], "zero_posts");
  // Title, content and slug are core post columns, not fields; the rest are `zero_<col>` meta.
  assert.deepEqual(Object.values(posts[2]), ["zero_excerpt", "zero_cover", "zero_tags", "zero_authorId", "zero_seo", "zero_gallery", "zero_sections", "zero_createdAt", "zero_updatedAt"]);
  assert.equal(posts[2].field_zero_posts_excerpt, "zero_excerpt");
  assert.deepEqual(scf.groups.find((g: any) => g[0] === "group_zero_global_settings").slice(0, 2), ["group_zero_global_settings", "zero-global-settings"]);
  assert.deepEqual(scf.pages, [["zero-global-settings", "zero_global_settings", "zero-blog"]]);

  const tables = sql("SELECT TABLE_NAME AS t, ENGINE AS e FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'wp\\_zero%'");
  assert.deepEqual(tables.map((r) => [r.t, r.e]).sort(), [["wp_zero__migrations", "InnoDB"], ["wp_zero__revisions", "InnoDB"], ["wp_zero_comments", "InnoDB"], ["wp_zero_signups", "InnoDB"]]);
  assert.deepEqual(sql("SELECT id FROM wp_zero__migrations").map((r) => r.id), ["0001_init"]);
});

test("activation grants collection capabilities: editors all, authors their own, subscribers none", () => {
  const caps = (role: string) => JSON.parse(wp("eval", `echo wp_json_encode(array_keys(array_filter(get_role('${role}')->capabilities)));`)).filter((c: string) => c.endsWith("zero_posts"));
  assert.deepEqual(caps("editor").sort(), [
    "delete_others_zero_posts", "delete_private_zero_posts", "delete_published_zero_posts", "delete_zero_posts", "edit_others_zero_posts",
    "edit_private_zero_posts", "edit_published_zero_posts", "edit_zero_posts", "publish_zero_posts", "read_private_zero_posts",
  ]);
  assert.deepEqual(caps("author").sort(), ["delete_published_zero_posts", "delete_zero_posts", "edit_published_zero_posts", "edit_zero_posts", "publish_zero_posts"]);
  assert.deepEqual(caps("subscriber"), []);
});
