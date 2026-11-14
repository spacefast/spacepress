// spec.md §6, the schema lock: first.config.ts is the only way to change what First generates. Every
// route that could store a replacement for one of First's field groups, post types, taxonomies or
// options pages, or attach something to one of its kinds, is refused to the administrator too, with a
// message naming first.config.ts. So is making or changing any SCF post type, taxonomy, field group
// or options page on the site, First's or not: that is a schema change, and it goes through
// first.config.ts or the runtime schema. Content stays open.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auth, core, harness, run, sql, wp, type Role } from "../env.ts";
import { loginCookie } from "../login.ts";

const site = harness.url;
const abilities = `${site}/wp-json/wp-abilities/v1/abilities`;
const LOCKED = /^Refused: .* belongs to the app's schema, which First builds from first\.config\.ts\. Change it there and deploy the app; it can't be changed on the site\.$/;
const onKind = (value: string) => [[{ param: "post_type", operator: "==", value }]];
const field = (key: string) => ({ key, label: "Drift", name: "drift", type: "text" });
const group = (key: string, over: Record<string, unknown> = {}) => ({ key, title: "Drift", fields: [field(`field_${key}`)], location: onKind("post"), ...over });
/** How many SCF objects the site stores under these keys (SCF's import names its first, unfinished save by title). */
const stored = (...keys: string[]) => {
  const list = keys.map((k) => `'${k}'`).join(",");
  return Number(sql(`SELECT COUNT(*) AS n FROM wp_posts WHERE post_type LIKE 'acf-%' AND (post_name IN (${list}) OR post_title IN (${list}))`)[0].n);
};

interface Answer {
  status: number;
  body: any;
}
/** One ability through core's run route, as $who (anonymous when null). */
async function ability(name: string, input: unknown, who: Role | null = "admin", url = `${abilities}/${name}/run`, init: RequestInit = {}): Promise<Answer> {
  const res = await fetch(url, { method: "POST", body: JSON.stringify({ input }), ...init, headers: { "content-type": "application/json", ...(who ? auth(who) : {}), ...init.headers } });
  return { status: res.status, body: await res.json() };
}
const refused = (answer: Answer, what: string) => {
  assert.deepEqual([answer.status, answer.body.code], [403, "first_schema_locked"], `${what}: ${JSON.stringify(answer.body)}`);
  assert.match(answer.body.message, LOCKED, what);
};

// Everything SCF can store, in the forms that would change First's schema: First's own names (any
// letter case), and the site's own objects attached to a First kind or to a global's options page.
const DRIFT: [what: string, ability: string, input: Record<string, unknown>][] = [
  ["a field group on a First kind", "scf/create-field-group", group(`group_drift_a${run}`, { location: onKind("first_notes") })],
  ["a field group on a kind's post type, in another letter case", "scf/create-field-group", group(`group_drift_b${run}`, { location: onKind("First_Notes") })],
  ["a field group on a global's options page", "scf/create-field-group", group(`group_drift_c${run}`, { location: [[{ param: "options_page", operator: "==", value: "first-global-banner" }]] })],
  ["a field group named as one of First's", "scf/create-field-group", group(`group_first_drift${run}`)],
  ["a field group named as one of First's, in another letter case", "scf/create-field-group", group(`group_FIRST_drift${run}`)],
  ["a field with one of First's field keys", "scf/create-field-group", group(`group_drift_d${run}`, { fields: [field("field_first_notes_mood")] })],
  ["an options page that takes a global's place, under its option prefix", "scf/create-ui-options-page", { key: `ui_options_page_drift_b${run}`, title: "Drift", page_title: "Drift", menu_slug: `drift-${run}`, post_id: "first_global_banner" }],
  ["an imported field group on a First kind", "scf/import-field-group", group(`group_drift_e${run}`, { location: onKind("first_memos") })],
  ["a field added to First's field group", "scf/create-field", { ...field(`field_drift_f${run}`), parent: "group_first_notes" }],
  ["a post type with a First name", "scf/create-post-type", { key: `post_type_drift${run}`, title: "Drift", post_type: "first_drift" }],
  ["a taxonomy with a First name", "scf/create-taxonomy", { key: `taxonomy_drift_a${run}`, title: "Drift", taxonomy: "first_shelf" }],
  ["a taxonomy attached to a First kind", "scf/create-taxonomy", { key: `taxonomy_drift_b${run}`, title: "Drift", taxonomy: `shelf${run}`.slice(0, 20), object_type: ["first_notes"] }],
  ["an options page that takes a global's place", "scf/create-ui-options-page", { key: `ui_options_page_drift${run}`, title: "Drift", page_title: "Drift", menu_slug: "first-global-banner" }],
];
const driftKeys = DRIFT.flatMap(([, , input]) => [String(input.key), ...((input.fields as { key: string }[] | undefined) ?? []).map((f) => f.key)]);

test("the administrator can't store a replacement for anything First generates, through any SCF ability", async () => {
  for (const [what, name, input] of DRIFT) {
    refused(await ability(name, input), what);
  }
  assert.equal(stored(...driftKeys), 0, "nothing was stored");
});

test("every other actor is refused before the lock is reached: core's own answer, and nothing stored", async () => {
  const [, name, input] = DRIFT[0];
  assert.equal((await ability(name, input, null)).status, 401, "anonymous");
  for (const who of ["subscriber", "author", "editor"] as const) {
    assert.equal((await ability(name, input, who)).status, 403, who);
  }
  assert.equal(stored(String(input.key)), 0);
});

test("the same refusal on every form of the request: rest_route, letter case, trailing slash, method overrides, batch", async () => {
  const [, name, input] = DRIFT[8];
  refused(await ability(name, input, "admin", `${site}/?rest_route=/wp-abilities/v1/abilities/${name}/run`), "the rest_route query form");
  refused(await ability(name, input, "admin", `${site}/wp-json/WP-Abilities/V1/Abilities/${name}/run/`), "another letter case, with a trailing slash");
  refused(await ability(name, input, "admin", `${site}/index.php?rest_route=/wp-abilities/v1/abilities/${name}/run/`), "index.php with rest_route");
  // A GET made into a POST: the run route still sees a write.
  refused(await ability(name, input, "admin", `${abilities}/${name}/run?_method=POST`, { method: "POST" }), "?_method=POST");
  // An override to a method the run route doesn't take for a write is core's refusal; nothing runs.
  for (const init of [{ headers: { "x-http-method-override": "PUT" } }, { headers: { "x-http-method-override": "GET" } }]) {
    const answer = await ability(name, input, "admin", `${abilities}/${name}/run`, init);
    assert.ok(answer.status >= 400, JSON.stringify(answer.body));
  }
  const overridden = await ability(name, input, "admin", `${abilities}/${name}/run?_method=PATCH`);
  assert.ok(overridden.status >= 400, JSON.stringify(overridden.body));
  // Core's batch endpoint takes only routes that allow it; the run route doesn't, and the SCF post
  // types have no REST routes of their own.
  const batch = await fetch(`${site}/wp-json/batch/v1`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth("admin") },
    body: JSON.stringify({ requests: [{ method: "POST", path: `/wp-abilities/v1/abilities/${name}/run`, body: { input } }] }),
  });
  const [response] = (await batch.json()).responses;
  assert.equal(response.status, 400, JSON.stringify(response));
  for (const type of ["acf-field-group", "acf-field", "acf-post-type", "acf-taxonomy", "acf-ui-options-page"]) {
    const direct = await fetch(`${core}/${type}`, { method: "POST", headers: { "content-type": "application/json", ...auth("admin") }, body: JSON.stringify({ title: "Drift", slug: "group_first_notes", status: "publish" }) });
    assert.equal(direct.status, 404, `${type} has no core REST route`);
  }
  assert.equal(stored(String(input.key)), 0);
});

test("an agent on the MCP server is refused the same way", async () => {
  const url = `${site}/wp-json/mcp/mcp-adapter-default-server`;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", ...auth("admin") };
  const rpc = async (id: number, method: string, params: unknown) => fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  const init = await rpc(0, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "schema-lock", version: "1" } });
  headers["mcp-session-id"] = init.headers.get("mcp-session-id") ?? "";
  headers["mcp-protocol-version"] = (await init.json()).result.protocolVersion;
  const [, name, input] = DRIFT[0];
  const call = await (await rpc(1, "tools/call", { name: "mcp-adapter-execute-ability", arguments: { ability_name: name, parameters: input } })).json();
  assert.equal(call.result.isError, true, JSON.stringify(call));
  assert.match(call.result.content[0].text, LOCKED);
  assert.equal(stored(String(input.key)), 0);
});

test("SCF's editor screens, its import tool and its menu are closed, with a page naming first.config.ts", async () => {
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  const at = (path: string, init: RequestInit = {}) => fetch(`${site}${path}`, { redirect: "manual", ...init, headers: { cookie, ...init.headers } });
  // A nonce bound to this browser session, as the screen's own form would carry it: the screens are
  // closed, so a stale tab or a script is what still holds one.
  const logged = cookie.split("; ").find((c) => c.startsWith("wordpress_logged_in_")) ?? assert.fail("no session cookie");
  const [cookieName, cookieValue] = [logged.slice(0, logged.indexOf("=")), decodeURIComponent(logged.slice(logged.indexOf("=") + 1))];
  const nonce = (action: string) => wp("eval", `$_COOKIE['${cookieName}'] = base64_decode('${Buffer.from(cookieValue).toString("base64")}'); wp_set_current_user(${harness.users.admin.id}); echo wp_create_nonce('${action}');`);
  const closed = async (res: Response, what: string) => {
    assert.equal(res.status, 403, what);
    assert.match(await res.text(), /Refused: .*first\.config\.ts/, what);
  };

  // Every screen that makes or changes one of SCF's objects, and the lists and the Tools screen.
  for (const type of ["acf-field-group", "acf-post-type", "acf-taxonomy", "acf-ui-options-page"]) {
    await closed(await at(`/wp-admin/post-new.php?post_type=${type}`), `the new ${type} screen`);
    await closed(await at(`/wp-admin/edit.php?post_type=${type}`), `the ${type} list`);
  }
  await closed(await at("/wp-admin/edit.php?post_type=acf-field-group&page=acf-tools"), "SCF's Tools screen");
  // A stored object's edit screen, and its quick actions.
  const key = `group_cli_screen${run}`;
  wp("eval", `acf_import_field_group(json_decode('${JSON.stringify(group(key))}', true));`);
  const id = Number(sql(`SELECT ID FROM wp_posts WHERE post_name = '${key}'`)[0].ID);
  await closed(await at(`/wp-admin/post.php?post=${id}&action=edit`), "a stored field group's edit screen");
  await closed(await at(`/wp-admin/edit.php?post_type=acf-field-group&acfduplicate=${id}&_wpnonce=${nonce("bulk-posts")}`), "duplicate");
  // SCF's menu is gone, and wp-admin itself still loads.
  const dashboard = await at("/wp-admin/");
  assert.equal(dashboard.status, 200);
  assert.doesNotMatch(await dashboard.text(), /edit\.php\?post_type=acf-field-group/);

  /** Save a new field group from SCF's own form, as the screen posts it. */
  const save = async (groupKey: string, postType: string) => {
    const draft = Number(wp("post", "create", "--post_type=acf-field-group", "--post_status=auto-draft", "--post_title=Auto Draft", "--porcelain"));
    const body = new URLSearchParams({
      action: "editpost", post_ID: String(draft), post_type: "acf-field-group", _wpnonce: nonce(`update-post_${draft}`), _acf_nonce: nonce("field_group"), _acf_screen: "field_group", _acf_post_id: String(draft),
      post_title: "Drift", post_status: "publish", publish: "Save Changes", "acf_field_group[key]": groupKey, "acf_field_group[active]": "1",
      "acf_field_group[location][group_0][rule_0][param]": "post_type", "acf_field_group[location][group_0][rule_0][operator]": "==", "acf_field_group[location][group_0][rule_0][value]": postType,
    });
    return at("/wp-admin/post.php", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  };
  // On a First kind, under one of First's names, and one that is neither: all are schema changes.
  for (const [groupKey, postType] of [[`group_drift_g${run}`, "first_notes"], [`group_first_admin${run}`, "post"], [`group_own_admin${run}`, "post"]]) {
    await closed(await save(groupKey, postType), `${groupKey} on ${postType}`);
    assert.equal(stored(groupKey), 0);
  }

  // The import tool: a JSON export posted to SCF's Tools screen.
  const upload = async (objects: unknown[]) => {
    const form = new FormData();
    form.set("_acf_nonce", nonce("import"));
    form.set("import_type", "json");
    form.set("acf_import_file", new Blob([JSON.stringify(objects)], { type: "application/json" }), "drift.json");
    return at("/wp-admin/edit.php?post_type=acf-field-group&page=acf-tools", { method: "POST", body: form });
  };
  await closed(await upload([group(`group_drift_h${run}`, { location: onKind("first_notes") })]), "an import onto a First kind");
  assert.equal(stored(`group_drift_h${run}`, `field_group_drift_h${run}`), 0, "neither the group nor its fields were stored");
  // A post type whose name WordPress stores as First's (`register_post_type` strips the dot and lowers
  // the case), through the same tool.
  await closed(await upload([{ key: `post_type_drift_k${run}`, title: "Hijack", post_type: ".First_Notes", labels: { name: "Hijack" }, public: true }]), "an import of a post type named as First's");
  assert.equal(stored(`post_type_drift_k${run}`), 0);
  await closed(await upload([group(`group_own_import${run}`)]), "an import of the site's own");
  assert.equal(stored(`group_own_import${run}`), 0);
  assert.equal(wp("eval", "echo get_post_type_object('first_notes')->labels->name;"), "Notes", "First's post type is registered as First registers it");
  // SCF's editor-only AJAX (the field settings a field group screen loads) is closed with them.
  const ajax = await at("/wp-admin/admin-ajax.php", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ action: "acf/field_group/render_field_settings", nonce: nonce("acf_nonce") }) });
  assert.equal(ajax.status, 403);
  // A field of First's nested inside a repeater of the site's own group is named in the refusal.
  const nested = group(`group_drift_i${run}`, { fields: [{ ...field(`field_rep${run}`), type: "repeater", sub_fields: [field("field_first_notes_mood")] }] });
  refused(await ability("scf/create-field-group", nested), "a nested field with one of First's keys");
  // The fields First renders on content still work: a note's edit screen loads with its field.
  const note = Number(wp("post", "create", "--post_type=first_notes", "--post_title=Screen", "--post_status=publish", "--porcelain"));
  const edit = await at(`/wp-admin/post.php?post=${note}&action=edit`);
  assert.equal(edit.status, 200);
  assert.match(await edit.text(), /field_first_notes_mood/);
  wp("post", "delete", String(id), "--force");
});

test("a field group already in the database never applies to a First kind", async () => {
  // Stored by the operator's WP-CLI, which the lock doesn't refuse: an import made around the app.
  const key = `group_cli_drift${run}`;
  wp("eval", `acf_import_field_group(json_decode('${JSON.stringify(group(key, { location: onKind("first_notes"), show_in_rest: 1 }))}', true));`);
  assert.equal(stored(key), 1);
  const before = Number(sql(`SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'acf-field-group' AND post_status <> 'auto-draft'`)[0].n);
  const note = Number(wp("post", "create", "--post_type=first_notes", "--post_title=Locked", "--post_status=publish", "--porcelain"));
  const item = `${core}/first_notes/${note}`;
  const read = await (await fetch(`${item}?context=edit`, { headers: auth("admin") })).json();
  assert.deepEqual(Object.keys(read.acf ?? {}).filter((k) => k === "drift"), [], "the kind shows no stray field");
  await fetch(item, { method: "POST", headers: { "content-type": "application/json", ...auth("admin") }, body: JSON.stringify({ acf: { drift: "written" } }) });
  assert.equal(wp("eval", `echo wp_json_encode(metadata_exists('post', ${note}, 'drift'));`), "false", "and stores nothing through it");
  const cookie0 = await loginCookie(site, "admin", `${site}/wp-admin/`);
  const screen = await (await fetch(`${site}/wp-admin/post.php?post=${note}&action=edit`, { headers: { cookie: cookie0 } })).text();
  assert.doesNotMatch(screen, new RegExp(`field_${key}`), "the edit screen doesn't render it");
  assert.match(screen, /field_first_notes_mood/, "First's own field is there");
  // Nor can a copy of it be made on the site: the ability carries only the stored group's id, so the
  // refusal comes from the save itself.
  const id = Number(sql(`SELECT ID FROM wp_posts WHERE post_name = '${key}'`)[0].ID);
  refused(await ability("scf/duplicate-field-group", { identifier: id }), "duplicating a stored group that names a First kind");
  assert.equal(Number(sql(`SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'acf-field-group' AND post_status <> 'auto-draft'`)[0].n), before, "no copy was stored");
  // A stored object that is First's is never loaded: a post type stored around the lock under a name
  // WordPress registers as First's (it strips the dot) doesn't replace First's registration.
  wp("eval", `acf_import_post_type(['key' => 'post_type_cli_${run}', 'title' => 'Hijack', 'post_type' => '.first_notes', 'labels' => ['name' => 'Hijack'], 'public' => true]);`);
  assert.equal(stored(`post_type_cli_${run}`), 1);
  const registered = await (await fetch(`${core}/types/first_notes?context=edit`, { headers: auth("admin") })).json();
  assert.equal(registered.name, "Notes", JSON.stringify(registered).slice(0, 200));
  wp("post", "delete", String(sql(`SELECT ID FROM wp_posts WHERE post_name = 'post_type_cli_${run}'`)[0].ID), "--force");
  // Changing it on the site is refused, whichever way it would point; removing it is not.
  refused(await ability("scf/update-field-group", { ID: id, location: onKind("post") }), "taking it off the kind on the site");
  refused(await ability("scf/update-field-group", { ID: id, location: onKind("first_notes") }), "an update that keeps it on the kind");
  const read = await ability("scf/get-field-group", { identifier: id });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  const trashed = await ability("scf/trash-field-group", { identifier: id });
  assert.equal(trashed.status, 200, JSON.stringify(trashed.body));
  assert.equal(sql(`SELECT post_status FROM wp_posts WHERE ID = ${id}`)[0].post_status, "trash");
});

test("registered meta: a First field is written through First's validation or not at all", async () => {
  const note = Number(wp("post", "create", "--post_type=first_notes", "--post_title=Meta", "--post_status=publish", "--porcelain"));
  const item = `${core}/first_notes/${note}`;
  const write = (body: unknown) => fetch(item, { method: "POST", headers: { "content-type": "application/json", ...auth("admin") }, body: JSON.stringify(body) });
  // The field under its own name is First's write: validated as the config declares it.
  assert.equal((await write({ meta: { mood: 7 } })).status >= 400, true, "a text field refuses a number");
  assert.equal((await write({ meta: { mood: "calm" } })).status, 200);
  // The stored key itself, and a key the config doesn't declare, are no part of the route.
  await write({ meta: { first_mood: "raw", first_undeclared: "raw" } });
  assert.deepEqual(JSON.parse(wp("eval", `echo wp_json_encode([get_post_meta(${note}, 'first_mood', true), metadata_exists('post', ${note}, 'first_undeclared')]);`)), ["calm", false]);
  // wp-admin's Custom Fields box (its AJAX) can't add or change one of First's keys either.
  // The box's nonce, bound to this browser session as the box's own form would carry it.
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  const logged = cookie.split("; ").find((c) => c.startsWith("wordpress_logged_in_")) ?? assert.fail("no session cookie");
  const [name, value] = [logged.slice(0, logged.indexOf("=")), decodeURIComponent(logged.slice(logged.indexOf("=") + 1))];
  const nonce = wp("eval", `$_COOKIE['${name}'] = base64_decode('${Buffer.from(value).toString("base64")}'); wp_set_current_user(${harness.users.admin.id}); echo wp_create_nonce('add-meta');`);
  const box = (key: string) => fetch(`${site}/wp-admin/admin-ajax.php`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ action: "add-meta", post_id: String(note), metakeyinput: key, metavalue: "boxed", "_ajax_nonce-add-meta": nonce }),
  });
  // The control: the box works for a key of the site's own.
  await box(`plain_${run}`);
  assert.equal(wp("post", "meta", "get", String(note), `plain_${run}`), "boxed");
  // First's keys, in every form the database matches them by: letter case and accents.
  for (const key of ["first_mood", "First_Mood", "FIRST_MOOD", "fírst_mood", "first_undeclared"]) {
    await box(key);
  }
  // `_first_mood` is SCF's reference to First's field, written by First's own save.
  const keys = sql(`SELECT meta_key FROM wp_postmeta WHERE post_id = ${note} AND (meta_key LIKE '%mood%' OR meta_key LIKE '%undeclared%') ORDER BY meta_key`).map((r) => r.meta_key);
  assert.deepEqual(keys, ["_first_mood", "first_mood"], "only First's own keys, written by First");
  assert.equal(wp("post", "meta", "get", String(note), "first_mood"), "calm");
  // A field of the site's own, located on core posts only, posted on the First note's edit form: SCF
  // saves every field the form names, wherever it applies. It writes nothing on the note.
  // (Stored by the operator's WP-CLI: a field group can't be made on the site.)
  wp("eval", `acf_import_field_group(json_decode('${JSON.stringify(group(`group_site_on_post${run}`, { fields: [{ ...field(`field_site_on_post${run}`), name: `stray_${run}` }] }))}', true));`);
  assert.equal(stored(`field_site_on_post${run}`), 1, "the site's field is stored");
  const form = await (await fetch(`${site}/wp-admin/post.php?post=${note}&action=edit`, { headers: { cookie } })).text();
  const hidden = (n: string) => form.match(new RegExp(`name=['"]${n}['"][^>]*value=['"]([^'"]*)['"]`))?.[1] ?? assert.fail(`no ${n}`);
  const saved = await fetch(`${site}/wp-admin/post.php`, {
    method: "POST", redirect: "manual", headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      action: "editpost", post_ID: String(note), post_type: "first_notes", _wpnonce: hidden("_wpnonce"), _acf_nonce: hidden("_acf_nonce"), _acf_screen: "post", _acf_post_id: String(note),
      post_title: "Meta", post_status: "publish", save: "Update", originalaction: "editpost", original_post_status: "publish",
      [`acf[field_site_on_post${run}]`]: "stray", "acf[field_first_notes_mood]": "still calm",
    }),
  });
  assert.equal(saved.status, 302, (await saved.text()).slice(0, 300));
  assert.equal(wp("eval", `echo wp_json_encode(metadata_exists('post', ${note}, 'stray_${run}'));`), "false", "the site's field wrote nothing on the First note");
  assert.equal(wp("post", "meta", "get", String(note), "first_mood"), "still calm", "the note's own field saved, through First");
});

test("roles: a role First creates and the capabilities of a First kind keep their definition", async () => {
  /** What a role-editor plugin does, through WordPress's own role API (tests/wp/mu-plugins/role-editor.php). */
  const edit = async (body: unknown) => {
    const res = await fetch(`${site}/wp-json/first-test/v1/role`, { method: "POST", headers: { "content-type": "application/json", ...auth("admin") }, body: JSON.stringify(body) });
    return { status: res.status, notice: res.headers.get("first-schema-lock"), role: (await res.json()).role };
  };
  const caps = (role: string) => JSON.parse(wp("eval", `echo wp_json_encode(get_role('${role}')?->capabilities);`));
  const guest = caps("first_guest");
  assert.deepEqual(guest, { read: true });
  for (const body of [{ role: "first_guest", cap: "edit_posts" }, { role: "first_guest", remove: true }]) {
    const answer = await edit(body);
    assert.match(answer.notice ?? "", LOCKED, JSON.stringify(body));
    assert.deepEqual(answer.role, guest, "the request itself sees the role unchanged");
    assert.deepEqual(caps("first_guest"), guest);
  }
  for (const cap of ["edit_others_first_notes", "delete_first_memos", "edit_first_notes_item"]) {
    const answer = await edit({ role: "subscriber", cap });
    assert.match(answer.notice ?? "", LOCKED, cap);
    assert.equal(cap in caps("subscriber"), false, cap);
  }
  // Roles and capabilities that aren't First's are the site's to change.
  const open = await edit({ role: "subscriber", cap: `drift_${run}` });
  assert.deepEqual([open.notice, caps("subscriber")[`drift_${run}`]], [null, true]);
  wp("eval", `get_role('subscriber')->remove_cap('drift_${run}');`);
});

test("making a post type, taxonomy or field group on the site is refused, First's or not; stored ones keep working", async () => {
  // None of these names is First's: each is still a change to the site's schema.
  const OWN: [what: string, name: string, input: Record<string, unknown>][] = [
    ["a field group on core posts", "scf/create-field-group", group(`group_own${run}`)],
    ["an imported field group", "scf/import-field-group", group(`group_own_b${run}`)],
    ["a post type", "scf/create-post-type", { key: `post_type_own${run}`, title: "Books", post_type: `book${run}`.slice(0, 20) }],
    ["a taxonomy", "scf/create-taxonomy", { key: `taxonomy_own${run}`, title: "Shelves", taxonomy: `shelf${run}`.slice(0, 20), object_type: ["post"] }],
    ["an options page", "scf/create-ui-options-page", { key: `ui_options_page_own${run}`, title: "Own", page_title: "Own", menu_slug: `own-${run}` }],
  ];
  for (const [what, name, input] of OWN) {
    refused(await ability(name, input), what);
    assert.equal(stored(String(input.key)), 0, what);
  }
  // One the operator stored with WP-CLI is registered and works; the site reads and exports it, can't
  // change or copy it, and can move it to the trash.
  const type = `book${run}`.slice(0, 20);
  wp("eval", `acf_import_post_type(['key' => 'post_type_cli_own${run}', 'title' => 'Books', 'post_type' => '${type}', 'labels' => ['name' => 'Books'], 'public' => true, 'show_in_rest' => true]);`);
  const typeId = Number(sql(`SELECT ID FROM wp_posts WHERE post_name = 'post_type_cli_own${run}'`)[0].ID);
  assert.equal((await fetch(`${core}/types/${type}`, { headers: auth("admin") })).status, 200, "the stored post type is registered");
  assert.equal((await ability("scf/get-post-type", { identifier: typeId })).status, 200);
  assert.equal((await ability("scf/export-post-type", { identifier: typeId })).status, 200);
  refused(await ability("scf/update-post-type", { ID: typeId, title: "Renamed" }), "changing a stored post type");
  refused(await ability("scf/duplicate-post-type", { identifier: typeId }), "copying a stored post type");
  assert.equal((await ability("scf/trash-post-type", { identifier: typeId })).status, 200);
  wp("post", "delete", String(typeId), "--force");
});

test("what stays open: content, users, settings and plugin activation", async () => {

  const json = (who: Role, body: unknown, method = "POST") => ({ method, headers: { "content-type": "application/json", ...auth(who) }, body: JSON.stringify(body) });
  const note = await fetch(`${site}/__first/api/v1/notes`, json("editor", { title: `Open ${run}` }));
  assert.equal(note.status, 201, await note.clone().text());
  const edited = await fetch(`${site}/__first/api/v1/notes/${(await note.json()).data.id}`, json("editor", { title: `Edited ${run}` }, "PATCH"));
  assert.equal((await edited.json()).data.title, `Edited ${run}`);
  const corePost = await fetch(`${core}/posts`, json("editor", { title: `Core ${run}`, status: "publish" }));
  assert.equal(corePost.status, 201);
  const user = await fetch(`${core}/users`, json("admin", { username: `open${run}`, email: `open${run}@example.test`, password: `pw-${run}-A1!` }));
  assert.equal(user.status, 201, await user.clone().text());
  const setting = await fetch(`${core}/settings`, json("admin", { description: `Tagline ${run}` }));
  assert.equal((await setting.json()).description, `Tagline ${run}`);
  wp("plugin", "deactivate", "two-factor");
  const activated = await fetch(`${core}/plugins/two-factor/two-factor`, json("admin", { status: "active" }));
  assert.deepEqual([activated.status, (await activated.json()).status], [200, "active"]);
  // WP-CLI stays the operator's: `wp cap add` on a First kind's capability is theirs to run.
  wp("cap", "add", "subscriber", "edit_others_first_notes");
  assert.equal(wp("eval", "echo wp_json_encode(get_role('subscriber')->has_cap('edit_others_first_notes'));"), "true");
  wp("cap", "remove", "subscriber", "edit_others_first_notes");
});
