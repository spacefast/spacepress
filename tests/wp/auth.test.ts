// Feature 4 on real WordPress (§6.2): a browser-less PKCE sign-in against zero-identity, its Bearer
// on /wp-json/zero/v1, refresh rotation and reuse, guests created on first write and upgraded in
// place, suspension on every channel, and the `members` auth collection living in wp_users with
// its hidden columns never leaving the runtime. Application passwords keep working.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
// The test app's own typed client (run.sh builds tests/wp/app before the suites).
import { createClient } from "./app/zero/client/index.ts";
import { api, auth, harness, http, run, sql, wp } from "./env.ts";

const site = harness.url;
const app = { id: "app_zero_dev", redirect: `${site}/auth/callback` };
const b64 = (b: Buffer) => b.toString("base64url");
const HIDDEN = /"(passwordHash|suspendedAt|guest)":|\$P\$|\$wp\$|\$2y\$/;

async function call(method: string, path: string, opts: { token?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const headers: Record<string, string> = opts.token ? { authorization: `Bearer ${opts.token}` } : {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
  const res = await fetch(api + path + qs, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  return { status: res.status, text, json: text === "" ? undefined : JSON.parse(text) };
}

/** A member with a known password, created by an admin through the API (write-only `password`). */
async function member(tag: string) {
  const email = `${tag}-${run}@example.test`;
  const r = await http("POST", `${api}/members`, { as: "admin", body: { email, name: tag, password: `pw-${tag}-correct-horse` } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.data.id as number, email, password: `pw-${tag}-correct-horse`, row: r.json };
}

/** The authorization-code flow with only fetch: password sign-in → consent (cookie + CSRF) → token. */
async function signIn(login: string, password: string) {
  const signin = await fetch(`${site}/wp-json/zero-identity/v1/sign-in/password`, {
    method: "POST", headers: { "content-type": "application/json", origin: site }, body: JSON.stringify({ login, password }),
  });
  assert.equal(signin.status, 200, await signin.clone().text());
  const cookie = signin.headers.getSetCookie().find((c) => c.startsWith("zi_session="))!.split(";")[0];
  const verifier = b64(randomBytes(48));
  const query = new URLSearchParams({
    response_type: "code", client_id: app.id, redirect_uri: app.redirect, scope: "openid email profile",
    state: b64(randomBytes(24)), nonce: b64(randomBytes(24)), code_challenge_method: "S256",
    code_challenge: b64(createHash("sha256").update(verifier).digest()),
  });
  const page = await fetch(`${site}/identity/authorize?${query}`, { headers: { cookie }, redirect: "manual" });
  const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(await page.text())?.[1];
  assert.ok(csrf, "the consent page carries the session CSRF token");
  const consent = await fetch(`${site}/identity/authorize`, {
    method: "POST", redirect: "manual",
    headers: { cookie, origin: site, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...Object.fromEntries(query), csrf }),
  });
  const back = new URL(consent.headers.get("location")!);
  assert.equal(back.searchParams.get("state"), query.get("state"));
  return token({ grant_type: "authorization_code", client_id: app.id, redirect_uri: app.redirect, code: back.searchParams.get("code")!, code_verifier: verifier });
}

async function token(body: Record<string, string>) {
  const res = await fetch(`${site}/identity/token`, { method: "POST", body: new URLSearchParams(body) });
  return { status: res.status, json: await res.json() };
}

test("PKCE sign-in yields a Bearer that works on /zero/v1; refresh rotates and reuse fails", async () => {
  const ana = await member("ana");
  const tokens = await signIn(ana.email, ana.password);
  assert.equal(tokens.status, 200, JSON.stringify(tokens.json));

  const me = await call("GET", "/me", { token: tokens.json.access_token });
  assert.equal(me.status, 200);
  assert.equal(me.json.data.id, ana.id, "the Bearer resolves to the member's WordPress user");
  assert.equal(me.json.data.role, "subscriber");
  assert.equal(me.json.data.member.email, ana.email);
  assert.doesNotMatch(me.text, HIDDEN);

  const rotated = await token({ grant_type: "refresh_token", client_id: app.id, refresh_token: tokens.json.refresh_token });
  assert.equal(rotated.status, 200);
  assert.equal((await call("GET", "/me", { token: rotated.json.access_token })).json.data.id, ana.id, "the rotated access token works");
  const reuse = await token({ grant_type: "refresh_token", client_id: app.id, refresh_token: tokens.json.refresh_token });
  assert.deepEqual([reuse.status, reuse.json.error], [400, "invalid_grant"]);
  const after = await call("GET", "/me", { token: rotated.json.access_token });
  assert.deepEqual([after.status, after.json.code], [401, "unauthenticated"], "reuse revoked the family on /zero/v1 too");
});

test("guests: created on first write, below subscriber, upgraded in place with the same id", async () => {
  const zero = createClient({ url: api, auth: { guests: true } });
  const entry: any = await (zero as any).guestbook.create({ message: `hello ${run}` });
  const guest = (zero as any).auth.session();
  assert.ok(guest, "the first write signed in a guest");
  const me = await call("GET", "/me", { token: guest.accessToken });
  assert.equal(me.json.data.role, "guest");
  const id = me.json.data.id as number;
  assert.equal(sql(`SELECT meta_value FROM wp_usermeta WHERE user_id = ${id} AND meta_key = 'wp_capabilities'`)[0].meta_value, 'a:1:{s:10:"zero_guest";b:1;}');
  assert.ok(entry.id, "the write went through as the guest");
  assert.deepEqual([me.json.data.member.plan, me.json.data.member.points, me.json.data.member.tags], ["free", 0, []], "a guest member gets the collection's defaults");
  const review = await call("POST", "/reviews", { token: guest.accessToken, body: { body: "five stars" } });
  assert.deepEqual([review.status, review.json.code], [403, "forbidden"], "a subscriber rule excludes guests");

  // The guest hands its browser to the hosted screen and verifies an email there.
  const handoff = await fetch(`${site}/identity/handoff`, { method: "POST", headers: { authorization: `Bearer ${guest.accessToken}` } });
  const { handoff: code } = await handoff.json();
  const verifier = b64(randomBytes(48));
  const query = new URLSearchParams({
    response_type: "code", client_id: app.id, redirect_uri: app.redirect, scope: "openid email profile", state: b64(randomBytes(24)),
    nonce: b64(randomBytes(24)), code_challenge_method: "S256", code_challenge: b64(createHash("sha256").update(verifier).digest()), handoff: code,
  });
  const landing = await fetch(`${site}/identity/authorize?${query}`, { redirect: "manual" });
  assert.equal(landing.status, 302);
  assert.match(landing.headers.get("location")!, /\/identity\?upgrade=1&return_to=/);
  const cookie = landing.headers.getSetCookie().find((c) => c.startsWith("zi_session="))!.split(";")[0];
  const email = `guest-${run}@example.test`;
  const start = await fetch(`${site}/wp-json/zero-identity/v1/sign-in/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: site, cookie }, body: JSON.stringify({ email }),
  });
  const { data: { challenge_id } } = await start.json();
  // The harness keeps outgoing mail on disk (tests/wp/mu-plugins/capture-mail.php).
  const secret = /Your code is (\d{6})/.exec(wp("eval", `echo file_get_contents(WP_CONTENT_DIR . '/zero-test-mail/' . sanitize_file_name(${JSON.stringify(email)}) . '.txt');`))?.[1];
  assert.ok(secret, "the sign-in code was mailed");
  const verify = await fetch(`${site}/wp-json/zero-identity/v1/sign-in/verify`, {
    method: "POST", headers: { "content-type": "application/json", origin: site, cookie }, body: JSON.stringify({ challenge_id, code: secret }),
  });
  assert.deepEqual(await verify.json(), { data: { kind: "signed_in" } });
  const upgraded = sql(`SELECT u.user_email, m.meta_value FROM wp_users u JOIN wp_usermeta m ON m.user_id = u.ID AND m.meta_key = 'wp_capabilities' WHERE u.ID = ${id}`)[0];
  assert.deepEqual(upgraded, { user_email: email, meta_value: 'a:1:{s:10:"subscriber";b:1;}' }, "same id, now a subscriber with the verified email");
  assert.equal((await call("GET", "/me", { token: guest.accessToken })).status, 401, "the guest's earlier tokens ended with the upgrade");
});

test("suspension blocks every channel: Bearer, application password and cookie + nonce", async () => {
  const bo = await member("bo");
  const tokens = await signIn(bo.email, bo.password);
  const appPassword = wp("user", "application-password", "create", String(bo.id), `suspend-${run}`, "--porcelain");
  const login = wp("user", "get", String(bo.id), "--field=user_login");
  const basic = { Authorization: "Basic " + btoa(`${login}:${appPassword}`) };
  // A WordPress login cookie with its REST nonce, as wp-admin and themes send it.
  const loginRes = await fetch(`${site}/wp-login.php`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "wordpress_test_cookie=WP%20Cookie%20check" },
    body: new URLSearchParams({ log: login, pwd: bo.password, testcookie: "1" }),
  });
  const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const nonce = await (await fetch(`${site}/wp-admin/admin-ajax.php?action=rest-nonce`, { headers: { cookie } })).text();
  const viaCookie = () => fetch(`${api}/me`, { headers: { cookie, "x-wp-nonce": nonce } });
  assert.equal((await viaCookie()).status, 200, "cookie + nonce works before");
  assert.equal((await fetch(`${api}/me`, { headers: basic })).status, 200);
  wp("zero-identity", "suspend", String(bo.id));
  const bearer = await call("GET", "/me", { token: tokens.json.access_token });
  assert.deepEqual([bearer.status, bearer.json.code], [403, "suspended"]);
  // zero-identity refuses a suspended account's application password, so WordPress doesn't
  // authenticate it: the request is anonymous everywhere (no member, no writes, no abilities).
  const viaApp = await fetch(`${api}/me`, { headers: basic });
  assert.deepEqual([viaApp.status, (await viaApp.json()).data], [200, null]);
  const write = await fetch(`${api}/reviews`, { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: JSON.stringify({ body: "as suspended" }) });
  assert.equal(write.status, 401, "a suspended account can't write");
  const viaAbility = await fetch(`${site}/wp-json/wp-abilities/v1/abilities/blog/guestbook-create/run`, { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: JSON.stringify({ input: { message: "x" } }) });
  assert.equal(viaAbility.status, 401, "abilities refuse a suspended account too");
  // A session WordPress resolved some other way (a cookie issued before suspension, a plugin) still
  // meets WpAuth's own suspension check on every Zero channel.
  const viaRuntime = wp("eval", `wp_set_current_user(${bo.id}); try { \\Zero\\Wp\\WpAuth::current(); echo 'allowed'; } catch (\\Zero\\HttpError $e) { echo $e->errorCode; }`);
  assert.equal(viaRuntime, "suspended");
  // zero-identity also refuses native sign-in and destroys WordPress sessions on suspension.
  const cookieAfter = await viaCookie();
  assert.ok([401, 403].includes(cookieAfter.status), `the cookie no longer works (${cookieAfter.status})`);
  wp("zero-identity", "restore", String(bo.id));
  assert.equal((await fetch(`${api}/me`, { headers: basic })).status, 200, "restored accounts work again");
});

test("a member row is a WordPress user: wp_users, usermeta in SCF's forms, WordPress's password", async () => {
  const cy = await member("cy");
  assert.deepEqual(sql(`SELECT user_email, display_name FROM wp_users WHERE ID = ${cy.id}`)[0], { user_email: cy.email, display_name: "cy" });
  assert.match(sql(`SELECT user_pass FROM wp_users WHERE ID = ${cy.id}`)[0].user_pass, /^\$wp\$|^\$P\$|^\$2y\$/, "WordPress's own hash");
  const self = await signIn(cy.email, cy.password);
  const patched = await call("PATCH", `/members/${cy.id}`, { token: self.json.access_token, body: { points: 7, tags: ["beta"], handle: `cy-${run}` } });
  assert.equal(patched.status, 200, patched.text);
  const meta = Object.fromEntries(sql(`SELECT meta_key, meta_value FROM wp_usermeta WHERE user_id = ${cy.id} AND meta_key IN ('zero_points','zero_tags')`).map((r) => [r.meta_key, r.meta_value]));
  assert.deepEqual(meta, { zero_points: "7", zero_tags: 'a:1:{i:0;s:4:"beta";}' }, "multiple selects are SCF's serialized arrays");
  // An edit through SCF's own field API (what the profile screen saves) reads back through Zero.
  wp("eval", `update_field('field_zero_member_tags', ['early', 'beta'], 'user_${cy.id}');`);
  wp("user", "update", String(cy.id), "--display_name=Cy Edited");
  const row = await call("GET", `/members/${cy.id}`, { token: self.json.access_token });
  assert.deepEqual([row.json.data.name, row.json.data.tags, row.json.data.points], ["Cy Edited", ["early", "beta"], 7]);
  const filtered = await call("GET", "/members", { token: self.json.access_token, query: { where: JSON.stringify({ tags: { has: "early" } }) } });
  assert.deepEqual(filtered.json.data.map((r: any) => r.id), [cy.id], "filters compare SCF's stored form");
  const dupe = await member("dy");
  const taken = await call("PATCH", `/members/${dupe.id}`, { token: (await signIn(dupe.email, dupe.password)).json.access_token, body: { handle: `cy-${run}` } });
  assert.deepEqual([taken.status, taken.json.code, taken.json.pointer], [409, "unique_violation", "/handle"], "declared unique columns hold in usermeta");
  // Uniqueness compares the stored (SCF) form: a date is kept as Ymd.
  await call("PATCH", `/members/${cy.id}`, { token: self.json.access_token, body: { joined: "2026-01-02" } });
  const sameDay = await call("PATCH", `/members/${dupe.id}`, { token: (await signIn(dupe.email, dupe.password)).json.access_token, body: { joined: "2026-01-02" } });
  assert.deepEqual([sameDay.status, sameDay.json.pointer], [409, "/joined"]);
  // A member's role is the one Zero authenticates them with: a contributor is an author.
  wp("user", "set-role", String(dupe.id), "contributor");
  const asContributor = await call("GET", "/me", { token: (await signIn(dupe.email, dupe.password)).json.access_token });
  assert.deepEqual([asContributor.json.data.role, asContributor.json.data.member.role], ["author", "author"]);
  const byRole = JSON.parse(wp("zero", "find", "members", JSON.stringify({ where: { id: dupe.id, role: "author" } })));
  assert.deepEqual(byRole.data.map((r: any) => r.id), [dupe.id], "filters on role decide it as authentication does");
  // Capabilities granted or denied to the user directly count the same way.
  wp("user", "set-role", String(dupe.id), "subscriber");
  wp("user", "add-cap", String(dupe.id), "manage_options");
  const granted = JSON.parse(wp("zero", "find", "members", JSON.stringify({ where: { id: dupe.id } })));
  assert.equal(granted.data[0].role, "admin", "a direct grant of manage_options makes an admin");
  wp("user", "remove-cap", String(dupe.id), "manage_options");
  wp("user", "set-role", String(dupe.id), "editor");
  wp("eval", `$u = new WP_User(${dupe.id}); $u->add_cap('edit_others_posts', false);`);
  const denied = JSON.parse(wp("zero", "find", "members", JSON.stringify({ where: { id: dupe.id, role: "author" } })));
  assert.deepEqual(denied.data.map((r: any) => r.role), ["author"], "an editor denied edit_others_posts is an author, in filters too");
  wp("eval", `$u = new WP_User(${dupe.id}); $u->remove_cap('edit_others_posts'); $u->set_role('contributor'); $u->add_cap('edit_posts', false);`);
  const contributorDenied = JSON.parse(wp("zero", "find", "members", JSON.stringify({ where: { id: dupe.id, role: "subscriber" } })));
  assert.deepEqual(contributorDenied.data.map((r: any) => r.role), ["subscriber"], "a contributor denied edit_posts holds no author capability: a subscriber");
  const authRole = wp("eval", `echo \\Zero\\Wp\\WpAuth::map(new WP_User(${dupe.id}))['role'];`);
  assert.equal(authRole, "subscriber", "the same answer authentication gives");
  // Several roles, one granting and a later one denying manage_options: rows follow WordPress's merge.
  wp("eval", `add_role('zero_test_deny', 'Deny', ['manage_options' => false]); $u = new WP_User(${dupe.id}); $u->set_role('administrator'); $u->add_role('zero_test_deny');`);
  const merged = JSON.parse(wp("zero", "find", "members", JSON.stringify({ where: { id: dupe.id } })));
  assert.equal(merged.data[0].role, wp("eval", `echo \\Zero\\Wp\\WpAuth::map(new WP_User(${dupe.id}))['role'];`), "the row's role is the authenticated role");
  wp("eval", `$u = new WP_User(${dupe.id}); $u->remove_role('zero_test_deny'); $u->set_role('subscriber'); remove_role('zero_test_deny');`);
});

test("a hosted sign-up (no Zero create) is a member with the collection's defaults", async () => {
  const email = `hosted-${run}@example.test`;
  const start = await fetch(`${site}/wp-json/zero-identity/v1/sign-in/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: site }, body: JSON.stringify({ email }),
  });
  const { data: { challenge_id } } = await start.json();
  const code = /Your code is (\d{6})/.exec(wp("eval", `echo file_get_contents(WP_CONTENT_DIR . '/zero-test-mail/' . sanitize_file_name(${JSON.stringify(email)}) . '.txt');`))?.[1];
  const verify = await fetch(`${site}/wp-json/zero-identity/v1/sign-in/verify`, {
    method: "POST", headers: { "content-type": "application/json", origin: site }, body: JSON.stringify({ challenge_id, code }),
  });
  assert.deepEqual(await verify.json(), { data: { kind: "signed_in" } });
  const id = Number(sql(`SELECT ID FROM wp_users WHERE user_email = '${email}'`)[0].ID);
  const row = JSON.parse(wp("zero", "find", "members", JSON.stringify({ where: { id } })));
  assert.deepEqual([row.data[0].plan, row.data[0].points, row.data[0].tags], ["free", 0, []]);
});

test("existing WordPress users become members with defaults when the app (re)activates", () => {
  const id = wp("user", "create", `before-${run}`, `before-${run}@example.test`, "--porcelain");
  wp("user", "meta", "delete", id, "zero_plan");
  wp("plugin", "deactivate", "zero-app-blog");
  wp("plugin", "activate", "zero-app-blog");
  assert.equal(wp("user", "meta", "get", id, "zero_plan"), "free");
});

test("a rolled-back member update leaves no usermeta in WordPress's cache", () => {
  const out = wp("eval", `
    $plugin = \\Zero\\Wp\\Runtime::plugin(); $db = $plugin->app()->db;
    $id = $db->insert('members', ['email' => 'rb-${run}@example.test', 'name' => 'rb'], true)[0]['id'];
    try { $db->transaction(function () use ($db, $id) {
      $db->update('members', ['points' => 99], ['id' => $id]);
      get_user_meta($id, 'zero_points', true); // a hook reads the new value
      throw new RuntimeException('rollback');
    }); } catch (RuntimeException $e) {}
    echo get_user_meta($id, 'zero_points', true);`);
  assert.equal(out, "0");
});

test("member showIf on profile forms: live rules on member fields, core-column rules settled on the saved member", () => {
  const id = wp("user", "create", `form-${run}`, `form-${run}@example.test`, "--porcelain", "--display_name=Plain");
  // What SCF's profile form renders: each member field after acf/prepare_field, for that user.
  const rendered = (user: string) => JSON.parse(wp("eval", [
    `acf_set_form_data(['post_id' => 'user_${user}']);`,
    "$out = [];",
    "foreach (acf_get_fields('group_zero_members') as $f) {",
    "  $p = apply_filters('acf/prepare_field', $f);",
    "  $out[$f['name']] = $p === false ? 'hidden' : ($p['conditional_logic'] ?: 0);",
    "}",
    "echo wp_json_encode(['perk' => $out['zero_perk'], 'badge' => $out['zero_badge'], 'sponsored' => $out['zero_sponsored'], 'fields' => array_keys($out)]);",
  ].join("\n")));
  const plain = rendered(id);
  assert.deepEqual(plain.perk, [[{ field: "field_zero_member_plan", operator: "==", value: "pro" }]], "a rule on a member field stays live for SCF");
  assert.equal(plain.badge, "hidden", "a rule on the core name column is settled against the saved member: not shown");
  assert.equal(plain.fields.includes("zero_sponsorId"), false, "references aren't profile fields");
  assert.equal(plain.sponsored, "hidden", "a rule on a non-profile column is settled against the saved member, never watching a missing field");
  wp("user", "update", id, "--display_name=Cy Edited");
  assert.equal(rendered(id).badge, 0, "once the saved name matches, the field shows unconditionally");
});

test("hidden columns never leave the runtime: list, get, with, write results, abilities", async () => {
  const ed = await member("ed");
  assert.doesNotMatch(JSON.stringify(ed.row), HIDDEN, "create result");
  const self = await signIn(ed.email, ed.password);
  const asSelf = { token: self.json.access_token };
  const list = await call("GET", "/members", asSelf);
  assert.deepEqual(list.json.data.map((r: any) => r.id), [ed.id], "\"self\": only the member's own row");
  const get = await call("GET", `/members/${ed.id}`, asSelf);
  const update = await call("PATCH", `/members/${ed.id}`, { ...asSelf, body: { points: 1 } });
  await call("POST", "/guestbook", { ...asSelf, body: { message: "mine", memberId: ed.id } });
  const withMember = await call("GET", "/guestbook", { ...asSelf, query: { with: "member" } });
  assert.ok(withMember.json.data.some((e: any) => e.member?.id === ed.id));
  const ability = await fetch(`${site}/wp-json/wp-abilities/v1/abilities/blog/members-get/run?input[id]=${ed.id}`, { headers: { authorization: `Bearer ${self.json.access_token}` } });
  const abilityText = await ability.text();
  assert.equal(ability.status, 200, abilityText);
  for (const [what, text] of [["list", list.text], ["get", get.text], ["update", update.text], ["with", withMember.text], ["abilities", abilityText]]) {
    assert.doesNotMatch(text, HIDDEN, what);
  }
});

test("hidden columns can't be filtered or ordered on, also through relations; role is admin-only", async () => {
  const fy = await member("fy");
  const asSelf = { token: (await signIn(fy.email, fy.password)).json.access_token };
  const hiddenFilter = await call("GET", "/members", { ...asSelf, query: { where: JSON.stringify({ passwordHash: { isNotNull: true } }) } });
  assert.deepEqual([hiddenFilter.status, hiddenFilter.json.code, hiddenFilter.json.pointer], [403, "forbidden", "/where/passwordHash"]);
  const throughRelation = await call("GET", "/guestbook", { query: { where: JSON.stringify({ member: { suspendedAt: null } }) } });
  assert.deepEqual([throughRelation.status, throughRelation.json.pointer], [403, "/where/member/suspendedAt"]);
  const promote = await call("PATCH", `/members/${fy.id}`, { ...asSelf, body: { role: "admin" } });
  assert.equal(promote.status, 403, "role is admin-only");
  assert.equal((await call("GET", "/members/1", asSelf)).status, 404, "another user's row is not this member's");
});

test("identity work joins the Zero transaction: a rollback leaves no guest, tokens or cached user", () => {
  // Inside one Zero transaction: create a guest (WordPress user + zero-identity session and tokens),
  // read it, then fail. Nothing may survive, and the object cache must not remember the user.
  const out = wp("eval", `
    $plugin = \\Zero\\Wp\\Runtime::plugin(); $app = $plugin->app(); $db = $plugin->connection();
    global $wpdb; $before = (int) $wpdb->get_var("SELECT MAX(ID) FROM {$wpdb->users}");
    try { $db->transaction(function () use ($app, &$id) {
        $id = $app->invoke('POST', '/auth/guest', [], '{}', new \\Zero\\Viewer(null, 'wp'))['user']['id'];
        get_userdata($id);
        throw new RuntimeException('rollback');
    }); } catch (RuntimeException $e) {}
    echo json_encode([
      'users' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->users} WHERE ID > $before"),
      'tokens' => (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$wpdb->prefix}zero_identity_tokens WHERE wp_user_id=%d", $id)),
      'cached' => get_userdata($id) !== false,
    ]);`);
  assert.deepEqual(JSON.parse(out), { users: 0, tokens: 0, cached: false });
});

test("activation refuses user tables that can't roll back with Zero (auth rows live there)", () => {
  // MyISAM wp_usermeta would keep member or guest writes through a rollback: the storage gate
  // reports it whether or not the app has an auth collection (guests are users either way).
  sql("ALTER TABLE wp_usermeta ENGINE=MyISAM");
  try {
    const bad = JSON.parse(wp("eval", `echo wp_json_encode(\\Zero\\Wp\\Runtime::plugin()->storageProblems());`));
    assert.ok(bad.includes("wp_usermeta"), JSON.stringify(bad));
  } finally {
    sql("ALTER TABLE wp_usermeta ENGINE=InnoDB");
  }
  const ok = JSON.parse(wp("eval", `echo wp_json_encode(\\Zero\\Wp\\Runtime::plugin()->storageProblems());`));
  assert.deepEqual(ok, []);
});

test("without zero-identity, a member's password still goes through wp_set_password", () => {
  const out = wp("eval", `
    $db = \\Zero\\Wp\\Runtime::plugin()->app()->db;
    \\Zero\\Auth\\Module::use(null); // as when zero-identity is inactive
    $id = $db->insert('members', ['email' => 'noid-${run}@example.test', 'name' => 'noid', 'password' => 'a long password 1'], true)[0]['id'];
    echo wp_check_password('a long password 1', get_userdata($id)->user_pass, $id) ? 'set' : 'unset';`);
  assert.equal(out, "set");
});

test("deleting a member through Zero deletes its identity: tokens dead, the email signs up afresh", async () => {
  const gy = await member("gy");
  const tokens = await signIn(gy.email, gy.password);
  const del = await http("DELETE", `${api}/members/${gy.id}`, { as: "admin" });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal((await call("GET", "/me", { token: tokens.json.access_token })).status, 401, "its Bearer is dead");
  const reuse = await token({ grant_type: "refresh_token", client_id: app.id, refresh_token: tokens.json.refresh_token });
  assert.equal(reuse.status, 400, "its refresh token is dead");
  assert.deepEqual(sql(`SELECT COUNT(*) AS n FROM wp_zero_identity_emails WHERE normalized = '${gy.email}'`), [{ n: "0" }], "its verified email is released");
});

test("a member can't set their own email where identity verifies emails; trusted writes can", async () => {
  const hy = await member("hy");
  const asSelf = { token: (await signIn(hy.email, hy.password)).json.access_token };
  const claim = await call("PATCH", `/members/${hy.id}`, { ...asSelf, body: { email: `victim-${run}@example.test` } });
  assert.deepEqual([claim.status, claim.json.code, claim.json.pointer], [403, "forbidden", "/email"]);
  // Nor can anyone (even with a public create rule) plant a member on an unverified address.
  const planted = wp("eval", `
    \\Zero\\Wp\\Runtime::plugin()->app();
    try {
      \\Zero\\db()->insert('members', ['email' => 'planted-${run}@example.test', 'name' => 'x', 'password' => 'a long password 1'], true, new \\Zero\\Viewer(null, 'wp'));
      echo 'created';
    } catch (\\Zero\\HttpError $e) { echo $e->status, ' ', $e->errorCode, ' ', $e->pointer, ' ', $e->getMessage(); }`);
  // The verified-email guard runs before the collection's create rule, so a public rule changes nothing.
  assert.equal(planted, "403 forbidden /email Members sign up on the account screen, where emails are verified");
  // Trusted writes (admin tooling, imports: `wp zero update`) still set it directly.
  const updated = JSON.parse(wp("zero", "update", "members", JSON.stringify({ id: hy.id }), JSON.stringify({ email: `hy-new-${run}@example.test` })));
  assert.equal(updated.data[0].email, `hy-new-${run}@example.test`);
});

test("deleting a member keeps the posts they authored", async () => {
  const iy = await member("iy");
  const post = wp("post", "create", "--post_type=zero_posts", "--post_title=Authored", "--post_status=publish", `--post_author=${iy.id}`, "--porcelain");
  await http("DELETE", `${api}/members/${iy.id}`, { as: "admin" });
  assert.deepEqual(sql(`SELECT post_status, post_author FROM wp_posts WHERE ID = ${post}`), [{ post_status: "publish", post_author: "0" }]);
});

test("application passwords still authenticate /zero/v1 as before", async () => {
  const me = await fetch(`${api}/me`, { headers: auth("editor") });
  assert.equal((await me.json()).data.role, "editor");
});
