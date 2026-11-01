// Editor parity (§1.7, §4.3, §4.9): saves through core /wp/v2/zero_posts with `acf` fields, the way the
// block editor saves, show up in /zero/v1 in the same request with Zero's decoded values; Zero's rules
// block bad values with Zero's message; afterCreate/afterUpdate run with the editing user. The test
// app's posts hooks (tests/wp/app) record each run as a comment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { core, http, ok, problem, run, sql, wp, zero } from "./env.ts";

test("a core REST save with acf fields reads back identically through /zero/v1 and runs the after hooks", async () => {
  const created = await http("POST", core + "/zero_posts", {
    as: "editor",
    body: {
      title: `Audit ${run}`,
      status: "publish",
      content: "<p>From the editor</p>",
      // The block editor sends every sub-field; an unchecked toggle inside a group is `false`.
      acf: { zero_excerpt: "Core excerpt", zero_tags: ["guide", "news"], zero_seo: { metaTitle: "SEO", noindex: false } },
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
  assert.equal(row.updatedAt, row.createdAt, "every `now` default of one editor save is the same instant");
  assert.deepEqual(row.comments.map((c: any) => [c.name, c.body]), [["afterCreate", "by Editor"]]);
  // Every declared default is filled, booleans and lists included; SCF's '' for an unchecked toggle is false.
  const event = await http("POST", core + "/zero_events", { as: "editor", body: { title: `Defaults ${run}`, status: "publish" } });
  assert.equal(event.status, 201, JSON.stringify(event.json));
  const defaults = await ok("GET", `/events/${event.json.id}`, { as: "editor" });
  assert.deepEqual([defaults.open, defaults.kinds, defaults.startsAt], [false, [], "2030-01-01T00:00:00.000Z"]);
  await http("POST", `${core}/zero_events/${event.json.id}`, { as: "editor", body: { acf: { zero_open: true } } });
  assert.equal((await ok("GET", `/events/${event.json.id}`, { as: "editor" })).open, true);
  await http("POST", `${core}/zero_events/${event.json.id}`, { as: "editor", body: { acf: { zero_open: false } } });
  assert.equal((await ok("GET", `/events/${event.json.id}`, { as: "editor" })).open, false);

  const updated = await http("POST", `${core}/zero_posts/${id}`, { as: "editor", body: { title: `Audit ${run} v2`, acf: { zero_excerpt: "Edited in core" } } });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  const after = await ok("GET", `/posts/${id}?with=comments`, { as: "editor" });
  assert.equal(after.excerpt, "Edited in core");
  assert.deepEqual(after.comments.map((c: any) => [c.name, c.body]), [
    ["afterCreate", "by Editor"],
    ["afterUpdate", `Audit ${run} -> Audit ${run} v2`],
  ]);

  // Core's own revision of an editor save carries the whole row, so it reads back and restores like a Zero one.
  const [rev] = await ok("GET", `/posts/${id}/revisions`, { as: "editor" });
  const fields = (r: any) => ({ title: r.title, slug: r.slug, excerpt: r.excerpt, tags: r.tags, seo: r.seo, createdAt: r.createdAt, status: r.status });
  const v2 = fields(after);
  assert.deepEqual(fields(await ok("GET", `/posts/${id}/revisions/${rev.id}`, { as: "editor" })), v2);
  // A fields-only save is a change too, though core compares only title/content/excerpt.
  await http("POST", `${core}/zero_posts/${id}`, { as: "editor", body: { acf: { zero_excerpt: "Third", zero_tags: ["release"] } } });
  const [third] = await ok("GET", `/posts/${id}/revisions`, { as: "editor" });
  assert.notEqual(third.id, rev.id);
  assert.deepEqual(fields(await ok("GET", `/posts/${id}/revisions/${third.id}`, { as: "editor" })), { ...v2, excerpt: "Third", tags: ["release"] });
  // Each revision keeps the slug it had (a revision post's own post_name is `<id>-revision-v1`).
  await http("POST", `${core}/zero_posts/${id}`, { as: "editor", body: { slug: `moved-${run}` } });
  const [moved] = await ok("GET", `/posts/${id}/revisions`, { as: "editor" });
  assert.equal((await ok("GET", `/posts/${id}/revisions/${moved.id}`, { as: "editor" })).slug, `moved-${run}`);
  assert.deepEqual(fields(await ok("GET", `/posts/${id}/revisions/${rev.id}`, { as: "editor" })), v2);
  assert.deepEqual(fields(await ok("POST", `/posts/${id}/revisions/${rev.id}/restore`, { as: "editor" })), v2);

  // A core-side status change needs no sync: the next read sees it.
  wp("post", "update", String(id), "--post_status=draft");
  assert.equal((await ok("GET", `/posts/${id}`, { as: "editor" })).status, "draft");
  const extensionRows = JSON.parse(wp("eval", `
    $db = \\Zero\\Wp\\Plugin::instance()->db();
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    \\Zero\\Extensions::onRead(static function (array $rows, string $c): array {
      if ($c === 'posts') {
        foreach ($rows as &$row) { $row['excerpt'] = 'display only'; }
        unset($row);
      }
      return $rows;
    });
    \\Zero\\Extensions::onWrite(static function (string $op, string $c, array &$row, ?array $previous) use ($db): void {
      if ($c === 'posts' && $op === 'delete' && str_starts_with($row['title'], 'Editor extension')) {
        $db->insert('comments', ['postId' => ${id}, 'name' => 'beforeDelete', 'body' => wp_json_encode([$row['excerpt'], $previous['excerpt']])]);
      }
    });
    \\Zero\\Extensions::onWritten(static function (string $op, string $c, array $row, ?array $previous) use ($db): void {
      if ($c === 'posts' && str_starts_with($row['title'], 'Editor extension')) {
        $db->insert('comments', ['postId' => ${id}, 'name' => $op, 'body' => wp_json_encode([$row['title'], $row['excerpt'], $previous['excerpt'] ?? null])]);
      }
    });
    $id = wp_insert_post(['post_type' => 'zero_posts', 'post_status' => 'publish', 'post_title' => 'Editor extension', 'meta_input' => ['zero_excerpt' => 'stored before']]);
    wp_update_post(['ID' => $id, 'post_title' => 'Editor extension updated', 'meta_input' => ['zero_excerpt' => 'stored after']]);
    wp_delete_post($id, true);
    echo wp_json_encode($db->findMany('comments', [
      'where' => ['postId' => ${id}, 'name' => ['in' => ['create', 'update', 'beforeDelete', 'delete']]],
      'columns' => ['name' => true, 'body' => true], 'orderBy' => ['id' => 'asc']
    ]));
  `));
  assert.deepEqual(extensionRows.map((row: { name: string; body: string }) => ({ name: row.name, body: JSON.parse(row.body) })), [
    { name: "create", body: ["Editor extension", "stored before", null] },
    { name: "update", body: ["Editor extension updated", "stored after", "stored before"] },
    { name: "beforeDelete", body: ["stored after", "stored after"] },
    { name: "delete", body: ["Editor extension updated", "stored after", "stored after"] },
  ]);
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

// Phase 2 §4.3 (lane B): `.showIf` lands in SCF's registered field group as conditional_logic, read
// back through SCF's own API. A rule on a sibling SCF can't watch (the core `status`) is settled when
// the edit form prepares the field for the post being edited.
test("showIf becomes SCF conditional_logic, including rules on core post columns", () => {
  const logic = JSON.parse(wp("eval", `echo wp_json_encode(array_map(fn ($k) => acf_get_field($k)['conditional_logic'], [
    'plan' => 'field_zero_field_staff_plan', 'discount' => 'field_zero_field_staff_discount',
    'private' => 'field_zero_field_staff_notes_private', 'kind' => 'field_zero_field_staff_kind',
    'postNote' => 'field_zero_field_staff_postNote', 'always' => 'field_zero_field_staff_always',
  ]));`));
  assert.deepEqual(logic, {
    plan: [[{ field: "field_zero_field_staff_kind", operator: "==", value: "pro" }]],
    discount: [
      [{ field: "field_zero_field_staff_kind", operator: "==", value: "basic" }],
      [{ field: "field_zero_field_staff_kind", operator: "==", value: "pro" }],
      [{ field: "field_zero_field_staff_active", operator: "==", value: "1" }],
    ],
    private: [[{ field: "field_zero_field_staff_notes_public", operator: "!=empty" }]],
    kind: 0,
    postNote: [[{ field: "field_zero_field_staff_postId", operator: "!==", value: "1" }]],
    always: 0,
  });
  // SCF's own registry of condition types: each emitted operator has one for its trigger field type.
  const types = JSON.parse(wp("eval", `echo wp_json_encode(array_map(fn ($k) => acf_get_field($k)['type'], ['kind' => 'field_zero_field_staff_kind', 'active' => 'field_zero_field_staff_active', 'public' => 'field_zero_field_staff_notes_public', 'postId' => 'field_zero_field_staff_postId']));`));
  assert.deepEqual(types, { kind: "select", active: "true_false", public: "text", postId: "post_object" });

  // headline: showIf({ status: "published", kind: "pro" }) on a published and on a draft post.
  const published = zero("insert", "field_staff", JSON.stringify({ name: `Shown ${run}`, kind: "pro" }))[0].id;
  const draft = zero("insert", "field_staff", JSON.stringify({ name: `Hidden ${run}`, kind: "pro", status: "draft" }))[0].id;
  const prepared = (id: number) => JSON.parse(wp("eval", `acf_set_form_data('post_id', ${id}); echo wp_json_encode(acf_prepare_field(acf_get_field('field_zero_field_staff_headline')));`));
  assert.deepEqual(prepared(published).conditional_logic, [[{ field: "field_zero_field_staff_kind", operator: "==", value: "pro" }]], "published: only the live kind rule remains");
  assert.equal(prepared(draft), false, "draft: the field is not rendered");
});

// Core /wp/v2 is Zero's rules too: the field rules /zero/v1 enforces refuse the same core save.
test("core /wp/v2 saves follow the field access /zero/v1 enforces", async () => {
  const id = zero("insert", "field_staff", JSON.stringify({ name: `Paid ${run}`, salary: 10 }))[0].id;
  await problem("PATCH", `/field_staff/${id}`, { as: "editor", body: { salary: 42 } }, { status: 403, code: "forbidden", pointer: "/salary" });
  const refused = await http("POST", `${core}/zero_field_staff/${id}`, { as: "editor", body: { acf: { zero_salary: 42 } } });
  assert.deepEqual([refused.status, refused.json.code, refused.json.data.pointer], [403, "forbidden", "/salary"]);
  assert.equal((await ok("GET", `/field_staff/${id}`, { as: "editor" })).salary, 10, "nothing was saved");
  const allowed = await http("POST", `${core}/zero_field_staff/${id}`, { as: "admin", body: { acf: { zero_salary: 42 } } });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
  assert.equal((await ok("GET", `/field_staff/${id}`, { as: "admin" })).salary, 42);
});

test("presentation metadata survives native SCF registration with stable nested keys", () => {
  const result: unknown = JSON.parse(wp("eval", `
    $schema = \\Zero\\Wp\\Plugin::instance()->schema;
    $def = ['type' => 'group', 'ui' => ['label' => 'Search preview'], 'fields' => [
      'summary' => ['type' => 'text', 'ui' => [
        'label' => 'Search title', 'help' => '<b>Plain text</b>', 'placeholder' => 'Write a title', 'width' => 50
      ]]
    ]];
    $field = \\Zero\\Wp\\Scf::fieldFor($schema, 'field_zero_ui_probe', 'zero_ui_probe', 'probe', $def, []);
    acf_add_local_field_group(['key' => 'group_zero_ui_probe', 'title' => 'Presentation test', 'fields' => [$field]]);
    $parent = acf_get_field('field_zero_ui_probe');
    $child = acf_get_field('field_zero_ui_probe_summary');
    echo wp_json_encode([
      'parentLabel' => $parent['label'], 'key' => $child['key'], 'name' => $child['name'],
      'label' => $child['label'], 'help' => $child['instructions'],
      'placeholder' => $child['placeholder'], 'width' => (int) $child['wrapper']['width']
    ]);
  `));
  assert.deepEqual(result, {
    parentLabel: "Search preview", key: "field_zero_ui_probe_summary", name: "summary",
    label: "Search title", help: "&lt;b&gt;Plain text&lt;/b&gt;", placeholder: "Write a title", width: 50,
  });
});
