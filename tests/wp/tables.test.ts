// `table()` custom tables (§4.2): rows live in wp_first_<table> in the §3.4 storage form, the
// cross-kind reference (comments.postId → a post) is checked and cascaded by the pipeline, and a
// MySQL UNIQUE violation maps to a 409 `unique_violation` with the column pointer. Also: db.globals from
// compiled code.
import { test } from "node:test";
import { createClient, FirstError } from "./app/first/client/index.ts";
import assert from "node:assert/strict";
import { api, auth, core, harness, http, ok, problem, run, sql, wp, wpTry, first } from "./env.ts";

test("comments are rows in wp_first_comments; references to posts are checked and cascade", async () => {
  const post = await ok("POST", "/posts", { as: "editor", body: { title: `Table ${run}` } });
  await ok("PATCH", `/posts/${post.id}`, { as: "editor", body: { status: "published" } });
  const draft = await ok("POST", "/posts", { as: "editor", body: { title: `Private ${run}`, status: "draft" } });
  for (const postId of [draft.id, 999_999_998]) {
    await problem("POST", "/comments", { body: { postId, name: "V", body: "x" } }, { status: 409, code: "reference_violation", pointer: "/postId" });
  }
  await ok("POST", "/comments", { as: "editor", body: { postId: draft.id, name: "Editor", body: "Allowed" } });
  const c = await ok("POST", "/comments", { body: { postId: post.id, name: "Visitor", body: "Hello" } });
  assert.deepEqual(sql(`SELECT postId, name, body, approved, createdAt FROM wp_first_comments WHERE id = ${c.id}`), [
    { postId: String(post.id), name: "Visitor", body: "Hello", approved: "0", createdAt: c.createdAt },
  ]);
  await problem("POST", "/comments", { body: { postId: 999_999_999, name: "V", body: "x" } }, { status: 409, code: "reference_violation", pointer: "/postId" });
  await ok("DELETE", `/posts/${post.id}`, { as: "editor" });
  assert.deepEqual(sql(`SELECT id FROM wp_first_comments WHERE id = ${c.id}`), [], "onDelete: cascade ran in the pipeline");
});

test("table relations use the generated client, SQL joins and the target's access rules", async () => {
  const editor = createClient({ url: api, headers: auth("editor") });
  const anonymous = createClient({ url: api });
  const team = await editor.fieldTeams.create({ name: `Relational ${run}`, budget: 250 });
  const signup = await editor.signups.create({ email: `relation-${run}@example.test`, teamId: team.id });
  const matches = await editor.signups.list({ where: { team: { name: team.name } }, with: { team: true } });
  assert.deepEqual(matches.map(row => [row.id, row.team?.id, row.team?.budget]), [[signup.id, team.id, undefined]]);
  const reverse = await editor.fieldTeams.get(team.id, { with: { signups: { where: { email: signup.email } } } });
  assert.deepEqual(reverse.signups.map(row => row.id), [signup.id]);
  await assert.rejects(anonymous.fieldTeams.get(team.id, { with: { signups: true } }), (error: unknown) => {
    assert.ok(error instanceof FirstError);
    assert.deepEqual([error.status, error.code], [401, "unauthenticated"], "a relation load must enforce target read access");
    return true;
  });
  await assert.rejects(editor.signups.list({ where: { team: { budget: 250 } } }), (error: unknown) => {
    assert.ok(error instanceof FirstError);
    assert.deepEqual([error.status, error.code, error.pointer], [403, "forbidden", "/where/team/budget"]);
    return true;
  });
  assert.deepEqual(sql(`SELECT teamId FROM wp_first_signups WHERE id = ${signup.id}`), [{ teamId: String(team.id) }]);
  await editor.signups.delete(signup.id);
  await editor.fieldTeams.delete(team.id);
});

test("unique() maps to 409 with a pointer: the meta check on posts, SQL UNIQUE on tables", async () => {
  // authors.email is unique meta on a post-backed collection: no SQL constraint exists, the store checks.
  first("insert", "authors", JSON.stringify({ name: "U1", email: `u-${run}@example.test` }));
  const dup = JSON.parse(wpTry("first", "insert", "authors", JSON.stringify({ name: "U2", email: `u-${run}@example.test` })));
  assert.deepEqual([dup.error.status, dup.error.code, dup.error.pointer], [409, "unique_violation", "/email"]);
  // signups (tests/wp/app) is an SQL table with a real UNIQUE index: MySQL error 1062, mapped.
  await ok("POST", "/signups", { as: "editor", body: { email: `s-${run}@example.test` } });
  for (const email of [`s-${run}@example.test`, `free-${run}@example.test`]) {
    await problem("POST", "/signups", { body: { email } }, { status: 401, code: "unauthenticated", pointer: "/email" });
  }
  await problem("POST", "/signups", { as: "editor", body: { email: `s-${run}@example.test` } }, { status: 409, code: "unique_violation", pointer: "/email" });
});

test("db.globals in compiled code reads and writes the WordPress-stored global", async () => {
  const start = (await ok("GET", "/globals/settings")).postsPerPage;
  assert.deepEqual(await ok("POST", "/actions/bumpPostsPerPage", { as: "editor", body: {} }), [start, start + 1]);
  assert.equal((await ok("GET", "/globals/settings")).postsPerPage, start + 1);
});

test("unique fields, filtered references and restrictive deletes hide competing rows on both REST surfaces", async () => {
  const trip = first("insert", "round_trips", JSON.stringify({ title: `Round trip ${run}`, ownerId: harness.users.editor.id, secretCode: `secret-${run}` }))[0];
  const nativeDraft = (owner: number) => Number(wp("eval", `$id = wp_insert_post(['post_type' => 'first_round_trips', 'post_status' => 'draft', 'post_title' => 'Native draft ${run}', 'post_name' => '${trip.slug}'], true); if (is_wp_error($id)) throw new Exception($id->get_error_message()); update_field('field_first_round_trips_ownerId', ${owner}, $id); echo $id;`));
  const hiddenDraft = nativeDraft(harness.users.admin.id);
  assert.equal(wp("post", "get", String(hiddenDraft), "--field=post_name"), trip.slug);
  const pulled = await ok("GET", "/sync/round_trips", { as: "editor" });
  const tripItem = pulled.records.find((item: { record?: { uid: string } }) => item.record?.uid === trip.uid);
  const tripRecord = { ...tripItem.record, fields: { ...tripItem.record.fields, title: `Edited ${run}` } };
  const echoed = await ok("POST", "/sync/round_trips", { as: "editor", body: { record: tripRecord, expect: tripItem.digest } });
  assert.equal(echoed.status, "applied");
  assert.equal((await ok("GET", `/round_trips/${trip.id}`, { as: "editor" })).slug, trip.slug, "a sync edit can resend a readable slug under a filtered read rule");
  await ok("PATCH", `/round_trips/${trip.id}`, { as: "editor", body: { slug: trip.slug } });
  const coreEcho = await http("POST", `${core}/first_round_trips/${trip.id}`, { as: "editor", body: { slug: trip.slug } });
  assert.equal(coreEcho.status, 200, JSON.stringify(coreEcho.json));
  assert.equal(wp("eval", `wp_set_current_user(${harness.users.editor.id}); $result = wp_update_post(['ID' => ${trip.id}, 'post_name' => '${trip.slug}'], true); if (is_wp_error($result)) throw new Exception($result->get_error_message()); echo get_post_field('post_name', $result);`), trip.slug);
  const readableDraft = nativeDraft(harness.users.editor.id);
  for (const body of [{ status: "published", slug: trip.slug }, { status: "published" }]) {
    await problem("PATCH", `/round_trips/${readableDraft}`, { as: "editor", body }, { status: 403, code: "forbidden", pointer: "/slug" });
  }
  const publishEcho = await http("POST", `${core}/first_round_trips/${readableDraft}`, { as: "editor", body: { status: "publish", slug: trip.slug } });
  assert.deepEqual([publishEcho.status, publishEcho.json.code, publishEcho.json.data?.pointer], [403, "forbidden", "/slug"], "publication needs visibility of competing rows even when its draft slug is readable");
  assert.equal(wp("post", "get", String(readableDraft), "--field=post_status"), "draft");
  const adminPublish = await http("POST", `${core}/first_round_trips/${readableDraft}`, { as: "admin", body: { status: "publish", slug: trip.slug } });
  assert.equal(adminPublish.status, 200, JSON.stringify(adminPublish.json));
  assert.equal(adminPublish.json.slug, `${trip.slug}-2`, "a viewer who can read competitors gets normal native collision resolution");
  const afterEcho = (await ok("GET", "/sync/round_trips", { as: "editor" })).records.find((item: { record?: { uid: string } }) => item.record?.uid === trip.uid);
  await problem("POST", "/sync/round_trips", { as: "editor", body: { record: { ...afterEcho.record, fields: { ...afterEcho.record.fields, secretCode: `secret-${run}` } }, expect: afterEcho.digest } }, { status: 403, code: "forbidden", pointer: "/secretCode" });
  const unreadable = first("insert", "round_trips", JSON.stringify({ title: `Other trip ${run}`, ownerId: harness.users.admin.id }))[0];
  await problem("PATCH", `/round_trips/${unreadable.id}`, { as: "editor", body: { slug: unreadable.slug } }, { status: 403, code: "forbidden", pointer: "/slug" });
  const keys = first("insert", "key_roots", JSON.stringify([{ code: 701001 }, { code: 701002 }]));
  first("insert", "key_links", JSON.stringify({ rootCode: keys[1].code }));
  for (const row of keys) {
    await problem("PATCH", `/key_roots/${row.id}`, { as: "editor", body: { code: row.code + 10 } }, { status: 409, code: "reference_violation", pointer: undefined });
    assert.equal(first("find", "key_roots", JSON.stringify({ where: { id: row.id } }))[0].code, row.code);
  }
  const privateRow = first("insert", "oracle_rows", JSON.stringify({ title: "Private", ownerId: harness.users.admin.id, code: `taken-${run}`, badge: 889001, publicBadge: 889101 }))[0];
  const own = first("insert", "oracle_rows", JSON.stringify({ title: "Own", ownerId: harness.users.editor.id }))[0];
  const unused = first("insert", "oracle_rows", JSON.stringify({ title: "Unused", ownerId: harness.users.editor.id }))[0];
  const person = first("insert", "payroll", JSON.stringify({ title: "Private badge", badge: 778001 }))[0];
  first("insert", "oracle_refs", JSON.stringify({ title: "Hidden child", rowId: own.id }));
  first("insert", "oracle_rows", JSON.stringify({ title: "Other private", ownerId: harness.users.admin.id }));
  const reference = first("insert", "oracle_refs", JSON.stringify({ title: "Writable reference" }))[0];
  for (const code of [`taken-${run}`, `free-${run}`]) {
    await problem("POST", "/oracle_rows", { as: "editor", body: { title: "Probe", ownerId: harness.users.editor.id, code } }, { status: 403, code: "forbidden", pointer: "/code" });
  }
  for (const occupied of [false, true]) {
    const slug = `native-probe-${occupied}-${run}`;
    const draft = await http("POST", `${core}/first_dossier`, { as: "admin", body: { title: "Native slug probe", slug, status: "draft" } });
    assert.equal(draft.status, 201, JSON.stringify(draft.json));
    if (occupied) {
      const other = await http("POST", `${core}/first_dossier`, { as: "admin", body: { title: "Competing native slug", slug, status: "publish" } });
      assert.equal(other.status, 201, JSON.stringify(other.json));
    }
    const publish = await http("POST", `${core}/first_dossier/${draft.json.id}`, { as: "editor", body: { status: "publish" } });
    assert.deepEqual([publish.status, publish.json.code], [403, "forbidden"]);
    assert.equal(first("find", "dossier", JSON.stringify({ where: { id: draft.json.id } }))[0].status, "draft");
    if (!occupied) {
      assert.equal((await http("POST", `${core}/first_dossier/${draft.json.id}`, { as: "admin", body: { status: "publish" } })).status, 200);
      assert.equal((await http("POST", `${core}/first_dossier/${draft.json.id}`, { as: "editor", body: { title: "Visible edit" } })).status, 200);
      assert.equal(first("find", "dossier", JSON.stringify({ where: { id: draft.json.id } }))[0].slug, slug);
      const renamed = `${slug}-renamed`;
      const result = wp("eval", `wp_set_current_user(${harness.users.admin.id}); $result = wp_update_post(['ID' => ${draft.json.id}, 'post_name' => '${renamed}'], true); if (is_wp_error($result)) throw new Exception($result->get_error_message()); echo get_post_field('post_name', $result);`);
      assert.equal(result, renamed, "a signed-in programmatic caller's explicit native slug is saved");
    }
  }
  for (const badge of [778001, 778002]) {
    await problem("PATCH", `/payroll/${person.id}`, { as: "editor", body: { badge } }, { status: 403, code: "forbidden", pointer: "/badge" });
    const coreWrite = await http("POST", `${core}/first_payroll/${person.id}`, { as: "editor", body: { acf: { first_badge: badge } } });
    assert.deepEqual([coreWrite.status, coreWrite.json.code], [403, "forbidden"]);
  }
  for (const rowId of [privateRow.id, 999_999_997]) {
    await problem("PATCH", `/oracle_refs/${reference.id}`, { as: "editor", body: { rowId } }, { status: 409, code: "reference_violation", pointer: "/rowId" });
    const coreWrite = await http("POST", `${core}/first_oracle_refs/${reference.id}`, { as: "editor", body: { acf: { first_rowId: rowId } } });
    assert.deepEqual([coreWrite.status, coreWrite.json.code], [409, "reference_violation"]);
  }
  for (const alias of [778001, 778002]) {
    await problem("PATCH", `/oracle_refs/${reference.id}`, { as: "editor", body: { alias } }, { status: 409, code: "reference_violation", pointer: "/alias" });
  }
  await ok("PATCH", `/oracle_refs/${reference.id}`, { as: "editor", body: { rowId: own.id } });
  for (const id of [own.id, unused.id]) {
    await problem("DELETE", `/oracle_rows/${id}`, { as: "editor" }, { status: 409, code: "reference_violation", pointer: undefined });
    const coreDelete = await http("DELETE", `${core}/first_oracle_rows/${id}?force=true`, { as: "editor" });
    assert.deepEqual([coreDelete.status, coreDelete.json.code], [409, "reference_violation"]);
  }
  const privatePeer = first("insert", "oracle_peers", JSON.stringify({ title: "Private peer", ownerId: harness.users.admin.id, locale: "en" }))[0];
  for (const [uid, targetUid] of [["zr_12121212121212121212", privatePeer.uid], ["zr_13131313131313131313", "zr_99999999999999999999"]]) {
    await ok("POST", "/sync/oracle_peers", { as: "editor", body: { record: { uid, fields: { title: "Unlinked peer", ownerId: harness.users.editor.id, locale: "fr", translations: { en: targetUid } }, body: null }, expect: "absent" } });
    const row = first("find", "oracle_peers", JSON.stringify({ where: { uid }, locale: "*" }))[0];
    assert.deepEqual(row.translations, { fr: row.id }, "hidden and absent translation peers both stay unlinked");
  }
  assert.deepEqual(first("find", "oracle_peers", JSON.stringify({ where: { id: privatePeer.id }, locale: "*" }))[0].translations, { en: privatePeer.id });
  for (const targetUid of [privateRow.uid, "zr_99999999999999999999"]) {
    const denied = await problem("POST", "/sync/oracle_sync", { as: "editor", body: { record: { uid: "zr_12341234123412341234", fields: { title: "Primary target", rowId: targetUid }, body: null }, expect: "absent" } }, { status: 409, code: "reference_violation", pointer: "/rowId" });
    assert.equal(denied.detail, "No referenced oracle_rows row for rowId", "hidden and absent primary targets return the same generic refusal");
    assert.deepEqual(first("find", "oracle_sync", JSON.stringify({ where: { uid: "zr_12341234123412341234" } })), [], "a refused reference never creates or links a row");
  }
  const synced = await ok("POST", "/sync/oracle_sync", { as: "editor", body: { record: { uid: "zr_12341234123412341234", fields: { title: "Readable UID", rowId: own.uid }, body: null }, expect: "absent" } });
  assert.equal(first("find", "oracle_sync", JSON.stringify({ where: { uid: synced.uid } }))[0].rowId, own.id, "a readable primary target still links");
  const hiddenTarget = await problem("POST", "/sync/oracle_sync", { as: "editor", body: { record: { uid: "zr_34563456345634563456", fields: { title: "Hidden badge", badgeId: privateRow.uid }, body: null }, expect: "absent" } }, { status: 409, code: "reference_violation", pointer: "/badgeId" });
  assert.equal(hiddenTarget.detail, "No referenced oracle_rows row for badgeId", "a UID refusal never prints its resolved hidden value");
  for (const targetUid of [privateRow.uid, "zr_99999999999999999999"]) {
    const filteredTarget = await problem("POST", "/sync/oracle_sync", { as: "editor", body: { record: { uid: "zr_78787878787878787878", fields: { title: "Filtered public badge", publicBadgeId: targetUid }, body: null }, expect: "absent" } }, { status: 409, code: "reference_violation", pointer: "/publicBadgeId" });
    assert.equal(filteredTarget.detail, "No referenced oracle_rows row for publicBadgeId", "filtered and absent non-primary targets have the same generic error");
  }
  await problem("POST", "/sync/oracle_sync", { as: "editor", body: { record: { uid: "zr_23452345234523452345", fields: { title: "Swap reference", rowId: own.uid }, body: null }, expect: "absent" } }, { status: 409, code: "reference_violation", pointer: "/rowId" });
  assert.equal(first("find", "payroll", JSON.stringify({ where: { id: person.id } }))[0].badge, 778001);
  assert.equal((await http("GET", `${api}/oracle_rows/${own.id}`, { as: "editor" })).status, 200);
});

test("cascades and generated editor values cannot answer questions about hidden rows", async () => {
  const source = first("insert", "oracle_rows", JSON.stringify({ title: "Generated source", ownerId: harness.users.admin.id, badge: 42 }))[0];
  for (const badge of [42, 142]) {
    first("update", "oracle_rows", JSON.stringify({ id: source.id }), JSON.stringify({ badge }));
    await problem("POST", "/derived_refs", { as: "editor", body: { title: "Default reference" } }, { status: 409, code: "reference_violation", pointer: "/badgeId" });
    await problem("POST", "/derived_refs", { as: "editor", body: { title: "Hook reference", badgeId: null } }, { status: 409, code: "reference_violation", pointer: "/badgeId" });
    await problem("POST", "/sync/derived_refs", { as: "editor", body: { record: { uid: "zr_56565656565656565656", fields: { title: "Default reference" }, body: null }, expect: "absent" } }, { status: 409, code: "reference_violation", pointer: "/badgeId" });
  }
  const roots = first("insert", "deep_roots", JSON.stringify([{ title: "Empty deep branch" }, { title: "Deep hidden branch" }]));
  let ancestor = first("insert", "deep_nodes", JSON.stringify({ title: "Hidden root", rootId: roots[1].id }))[0];
  for (let depth = 0; depth < 9; depth++) {
    ancestor = first("insert", "deep_nodes", JSON.stringify({ title: `Hidden depth ${depth}`, parentId: ancestor.id }))[0];
  }
  for (const root of roots) {
    await problem("DELETE", `/deep_roots/${root.id}`, { as: "editor" }, { status: 409, code: "reference_violation", pointer: undefined });
    const result = await http("DELETE", `${core}/first_deep_roots/${root.id}?force=true`, { as: "editor" });
    assert.deepEqual([result.status, result.json.code], [409, "reference_violation"]);
  }
  const empty = first("insert", "oracle_parents", JSON.stringify({ title: "Empty branch" }))[0];
  const parent = first("insert", "oracle_parents", JSON.stringify({ title: "With child" }))[0];
  const child = first("insert", "oracle_children", JSON.stringify({ title: "Cascade", parentId: parent.id }))[0];
  const nullEmpty = first("insert", "null_parents", JSON.stringify({ title: "No null children" }))[0];
  const nullParent = first("insert", "null_parents", JSON.stringify({ title: "Has null child" }))[0];
  const nullChild = first("insert", "null_children", JSON.stringify({ title: "Will null", parentId: nullParent.id, code: "original" }))[0];
  const hookEmpty = first("insert", "hook_parents", JSON.stringify({ title: "No hooked children" }))[0];
  const hookParent = first("insert", "hook_parents", JSON.stringify({ title: "Has hooked child" }))[0];
  first("insert", "hook_children", JSON.stringify({ title: "Will hook", parentId: hookParent.id, code: "original" }));
  const secretA = first("insert", "secret_parents", JSON.stringify({ title: "Linked secret", secret: 99101 }))[0];
  const secretB = first("insert", "secret_parents", JSON.stringify({ title: "Unlinked secret", secret: 99102 }))[0];
  first("insert", "secret_links", JSON.stringify({ title: "Known link", secret: 99101 }));
  const generated = first("insert", "oracle_defaults", JSON.stringify({ title: "Existing", code: "other" }))[0];
  for (const populated of [false, true]) {
    if (populated) {
      first("insert", "oracle_grand", JSON.stringify({ title: "Hidden", childId: child.id }));
      first("insert", "oracle_defaults", JSON.stringify({ title: "Taken defaults", touched: "reserved-update" }));
      first("insert", "null_children", JSON.stringify({ title: "Taken generated", code: "null-reserved" }));
      first("insert", "hook_children", JSON.stringify({ title: "Taken hook", code: "hook-reserved" }));
    }
    for (const id of [empty.id, parent.id]) {
      await problem("DELETE", `/oracle_parents/${id}`, { as: "editor" }, { status: 409, code: "reference_violation", pointer: undefined });
      const r = await http("DELETE", `${core}/first_oracle_parents/${id}?force=true`, { as: "editor" });
      assert.deepEqual([r.status, r.json.code], [409, "reference_violation"]);
    }
    for (const id of [secretA.id, secretB.id]) {
      await problem("DELETE", `/secret_parents/${id}`, { as: "editor" }, { status: 409, code: "reference_violation", pointer: undefined });
      const r = await http("DELETE", `${core}/first_secret_parents/${id}?force=true`, { as: "editor" });
      assert.deepEqual([r.status, r.json.code], [409, "reference_violation"]);
    }
    for (const id of [hookEmpty.id, hookParent.id]) {
      await problem("DELETE", `/hook_parents/${id}`, { as: "editor" }, { status: 403, code: "forbidden", pointer: "/code" });
      const r = await http("DELETE", `${core}/first_hook_parents/${id}?force=true`, { as: "editor" });
      assert.deepEqual([r.status, r.json.code], [403, "forbidden"]);
    }
    for (const id of [nullEmpty.id, nullParent.id]) {
      await problem("DELETE", `/null_parents/${id}`, { as: "editor" }, { status: 403, code: "forbidden", pointer: "/code" });
      const r = await http("DELETE", `${core}/first_null_parents/${id}?force=true`, { as: "editor" });
      assert.deepEqual([r.status, r.json.code], [403, "forbidden"]);
    }
    await problem("POST", "/oracle_defaults", { as: "editor", body: { title: "Probe" } }, { status: 403, code: "forbidden", pointer: "/code" });
    const create = await http("POST", `${core}/first_oracle_defaults`, { as: "editor", body: { title: "Probe" } });
    assert.deepEqual([create.status, create.json.code], [403, "forbidden"]);
    const update = await http("POST", `${core}/first_oracle_defaults/${generated.id}`, { as: "editor", body: { title: "Changed" } });
    assert.deepEqual([update.status, update.json.code], [403, "forbidden"]);
  }
  assert.equal(first("find", "null_children", JSON.stringify({ where: { id: nullChild.id } }))[0].parentId, nullParent.id);
  const defaultRows = first("insert", "default_only", JSON.stringify([{ title: "Empty hidden", code: null }, { title: "Filled hidden", code: "filled" }]));
  for (const row of defaultRows) {
    const result = await http("POST", `${core}/first_default_only/${row.id}`, { as: "editor", body: { title: "Probe default" } });
    assert.deepEqual([result.status, result.json.code], [403, "forbidden"], "backfill cannot reveal whether a hidden value is empty");
  }
  for (const exists of [false, true]) {
    if (exists) wp("eval", `wp_insert_post(['import_id' => 444444444, 'post_type' => 'first_oracle_rows', 'post_status' => 'publish', 'post_title' => 'Private default target']);`);
    await problem("POST", "/ref_defaults", { as: "editor", body: { title: "Generated reference" } }, { status: 409, code: "reference_violation", pointer: "/targetId" });
    const coreDefault = await http("POST", `${core}/first_ref_defaults`, { as: "editor", body: { title: "Generated reference" } });
    assert.deepEqual([coreDefault.status, coreDefault.json.code], [409, "reference_violation"]);
  }
  assert.equal(first("find", "oracle_defaults", JSON.stringify({ where: { id: generated.id } }))[0].title, "Existing");
  assert.equal(first("find", "oracle_children", JSON.stringify({ where: { id: child.id } })).length, 1);
});
