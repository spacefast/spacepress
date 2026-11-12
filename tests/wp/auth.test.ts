// Feature 4 on real WordPress (§6.2): a browser-less PKCE sign-in against first-identity, its Bearer
// on /__first/api/v1, refresh rotation and reuse, guests created on first write and upgraded in
// place, suspension on every channel, and the `members` auth collection living in wp_users with
// its hidden columns never leaving the runtime. Application passwords keep working.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The test app's own typed client (run.sh builds tests/wp/app before the suites).
import { createClient } from "./app/first/_generated/client/index.ts";
import { api, auth, harness, http, run, sql, wp, wpTry, first } from "./env.ts";

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

/** Trusted setup: self-read intentionally cannot inspect competing members through unique writes. */
async function member(tag: string) {
  const email = `${tag}-${run}@example.test`;
  const row = first("insert", "members", JSON.stringify({ email, name: tag, password: `pw-${tag}-correct-horse` }))[0];
  return { id: row.id, email, password: `pw-${tag}-correct-horse`, row: { data: row } };
}

/** The authorization-code flow with only fetch: password sign-in → consent (cookie + CSRF) → token. */
async function signIn(login: string, password: string) {
  const signin = await fetch(`${site}/wp-json/first-identity/v1/sign-in/password`, {
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

test("PKCE sign-in yields a Bearer that works on /__first/api/v1; refresh rotates and reuse fails", async () => {
  const ana = await member("ana");
  const tokens = await signIn(ana.email, ana.password);
  assert.equal(tokens.status, 200, JSON.stringify(tokens.json));

  const me = await call("GET", "/me", { token: tokens.json.access_token });
  assert.equal(me.status, 200);
  assert.equal(me.json.data.id, ana.id, "the Bearer resolves to the member's WordPress user");
  assert.equal(me.json.data.role, "subscriber");
  assert.equal(me.json.data.email, ana.email);
  assert.doesNotMatch(me.text, HIDDEN);

  const rotated = await token({ grant_type: "refresh_token", client_id: app.id, refresh_token: tokens.json.refresh_token });
  assert.equal(rotated.status, 200);
  assert.equal((await call("GET", "/me", { token: rotated.json.access_token })).json.data.id, ana.id, "the rotated access token works");
  const reuse = await token({ grant_type: "refresh_token", client_id: app.id, refresh_token: tokens.json.refresh_token });
  assert.deepEqual([reuse.status, reuse.json.error], [400, "invalid_grant"]);
  const after = await call("GET", "/me", { token: rotated.json.access_token });
  assert.deepEqual([after.status, after.json.code], [401, "unauthenticated"], "reuse revoked the family on /__first/api/v1 too");
});

test("an opted-in host's identity cookie works on /__first/api/v1 from its own pages only", async () => {
  const host = await member("host-cookie");
  const signin = await fetch(`${site}/wp-json/first-identity/v1/sign-in/password`, {
    method: "POST", headers: { "content-type": "application/json", origin: site }, body: JSON.stringify({ login: host.email, password: host.password }),
  });
  const cookie = signin.headers.getSetCookie().find((c) => c.startsWith("zi_session="))!.split(";")[0];
  const me = (headers: Record<string, string> = {}) => fetch(`${api}/me`, { headers: { cookie, ...headers } });
  assert.equal((await (await me()).json()).data, null, "cookies are off on /__first/api/v1 unless the host opts in");
  wp("option", "update", "first_test_rest_cookie_auth", "1");
  try {
    const own = await me({ origin: site });
    assert.equal((await own.json()).data.id, host.id, "a same-origin request is the signed-in member");
    assert.match(own.headers.get("cache-control") ?? "", /no-store|no-cache/, "a cookie-authenticated answer is never shared");
    assert.equal((await (await me()).json()).data.id, host.id, "a navigation or same-origin GET without Origin too");
    assert.equal((await (await me({ origin: "https://sibling.example.test" })).json()).data, null, "another origin borrows no identity");
    assert.equal((await (await me({ "sec-fetch-site": "cross-site" })).json()).data, null, "nor does a cross-site fetch");
    const write = (headers: Record<string, string>) =>
      fetch(`${api}/reviews`, { method: "POST", headers: { cookie, "content-type": "application/json", ...headers }, body: JSON.stringify({ body: `cookie ${run}` }) });
    assert.equal((await write({ origin: site })).status, 201, "the app's own pages write as the member");
    const forged = await write({});
    assert.deepEqual([forged.status, (await forged.json()).code], [403, "invalid_csrf"], "a write without Origin needs the session's CSRF token");
    // A cross-site GET navigation carries a Lax cookie; WordPress would dispatch it as the overridden method.
    for (const [path, headers] of [
      ["/reviews?_method=POST", {}],
      ["/reviews", { "x-http-method-override": "POST" }],
    ] as const) {
      const overridden = await fetch(`${api}${path}`, { headers: { cookie, ...headers } });
      assert.deepEqual([overridden.status, (await overridden.json()).code], [403, "invalid_csrf"], `a method override is judged as a write: ${path}`);
    }
  } finally {
    wp("option", "delete", "first_test_rest_cookie_auth");
  }
});

test("guests: created on first write, below subscriber, upgraded in place with the same id", async () => {
  const first = createClient({ url: api, auth: { guests: true } });
  const entry: any = await (first as any).guestbook.create({ message: `hello ${run}` });
  const guest = (first as any).auth.session();
  assert.ok(guest, "the first write signed in a guest");
  const me = await call("GET", "/me", { token: guest.accessToken });
  assert.equal(me.json.data.role, "guest");
  const id = me.json.data.id as number;
  assert.equal(sql(`SELECT meta_value FROM wp_usermeta WHERE user_id = ${id} AND meta_key = 'wp_capabilities'`)[0].meta_value, 'a:1:{s:11:"first_guest";b:1;}');
  assert.ok(entry.id, "the write went through as the guest");
  assert.deepEqual([me.json.data.plan, me.json.data.points, me.json.data.tags], ["free", 0, []], "a guest member gets the collection's defaults");
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
  const start = await fetch(`${site}/wp-json/first-identity/v1/sign-in/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: site, cookie }, body: JSON.stringify({ email }),
  });
  const { data: { challenge_id } } = await start.json();
  // The harness keeps outgoing mail on disk (tests/wp/mu-plugins/capture-mail.php).
  const secret = /Your code is (\d{6})/.exec(wp("eval", `echo file_get_contents(WP_CONTENT_DIR . '/first-test-mail/' . sanitize_file_name(${JSON.stringify(email)}) . '.txt');`))?.[1];
  assert.ok(secret, "the sign-in code was mailed");
  const verify = await fetch(`${site}/wp-json/first-identity/v1/sign-in/verify`, {
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
  wp("first", "identity", "suspend", String(bo.id));
  const bearer = await call("GET", "/me", { token: tokens.json.access_token });
  assert.deepEqual([bearer.status, bearer.json.code], [403, "suspended"]);
  // first-identity refuses a suspended account's application password: the API says so (403
  // account_unavailable, as core's authentication error is), and never acts as the account.
  const viaApp = await fetch(`${api}/me`, { headers: basic });
  assert.deepEqual([viaApp.status, (await viaApp.json()).code], [403, "account_unavailable"]);
  const write = await fetch(`${api}/reviews`, { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: JSON.stringify({ body: "as suspended" }) });
  assert.equal(write.status, 403, "a suspended account can't write");
  const viaAbility = await fetch(`${site}/wp-json/wp-abilities/v1/abilities/blog/guestbook-create/run`, { method: "POST", headers: { ...basic, "content-type": "application/json" }, body: JSON.stringify({ input: { message: "x" } }) });
  assert.equal(viaAbility.status, 401, "abilities refuse a suspended account too");
  // A session WordPress resolved some other way (a cookie issued before suspension, a plugin) still
  // meets WpAuth's own suspension check on every First channel.
  const viaRuntime = wp("eval", `wp_set_current_user(${bo.id}); try { \\First\\Wp\\WpAuth::current(); echo 'allowed'; } catch (\\First\\HttpError $e) { echo $e->errorCode; }`);
  assert.equal(viaRuntime, "suspended");
  // first-identity also refuses native sign-in and destroys WordPress sessions on suspension.
  const cookieAfter = await viaCookie();
  assert.ok([401, 403].includes(cookieAfter.status), `the cookie no longer works (${cookieAfter.status})`);
  wp("first", "identity", "restore", String(bo.id));
  assert.equal((await fetch(`${api}/me`, { headers: basic })).status, 200, "restored accounts work again");
});

test("a member row is a WordPress user: wp_users, usermeta in SCF's forms, WordPress's password", async () => {
  const cy = await member("cy");
  assert.deepEqual(sql(`SELECT user_email, display_name FROM wp_users WHERE ID = ${cy.id}`)[0], { user_email: cy.email, display_name: "cy" });
  assert.match(sql(`SELECT user_pass FROM wp_users WHERE ID = ${cy.id}`)[0].user_pass, /^\$wp\$|^\$P\$|^\$2y\$/, "WordPress's own hash");
  const self = await signIn(cy.email, cy.password);
  const patched = await call("PATCH", `/members/${cy.id}`, { token: self.json.access_token, body: { points: 7, tags: ["beta"] } });
  assert.equal(patched.status, 200, patched.text);
  const meta = Object.fromEntries(sql(`SELECT meta_key, meta_value FROM wp_usermeta WHERE user_id = ${cy.id} AND meta_key IN ('first_points','first_tags')`).map((r) => [r.meta_key, r.meta_value]));
  assert.deepEqual(meta, { first_points: "7", first_tags: 'a:1:{i:0;s:4:"beta";}' }, "multiple selects are SCF's serialized arrays");
  // An edit through SCF's own field API (what the profile screen saves) reads back through First.
  wp("eval", `update_field('field_first_member_tags', ['early', 'beta'], 'user_${cy.id}');`);
  wp("user", "update", String(cy.id), "--display_name=Cy Edited");
  const row = await call("GET", `/members/${cy.id}`, { token: self.json.access_token });
  assert.deepEqual([row.json.data.name, row.json.data.tags, row.json.data.points], ["Cy Edited", ["early", "beta"], 7]);
  const filtered = await call("GET", "/members", { token: self.json.access_token, query: { where: JSON.stringify({ tags: { has: "early" } }) } });
  assert.deepEqual(filtered.json.data.map((r: any) => r.id), [cy.id], "filters compare SCF's stored form");
  const dupe = await member("dy");
  const dupeToken = (await signIn(dupe.email, dupe.password)).json.access_token;
  first("update", "members", JSON.stringify({ id: cy.id }), JSON.stringify({ handle: `cy-${run}`, joined: "2026-01-02" }));
  for (const handle of [`cy-${run}`, `free-${run}`]) {
    const refused = await call("PATCH", `/members/${dupe.id}`, { token: dupeToken, body: { handle } });
    assert.deepEqual([refused.status, refused.json.code, refused.json.pointer], [403, "forbidden", "/handle"], "self-read never reveals a competing handle");
  }
  for (const email of [cy.email, `free-${run}@example.test`]) {
    const refused = await http("POST", `${api}/members`, { as: "admin", body: { email, name: "Probe", password: "probe password 1" } });
    assert.deepEqual([refused.status, refused.json.code, refused.json.pointer], [403, "forbidden", "/email"], "self-read applies even to admin collection writes");
  }
  const taken = JSON.parse(wpTry("first", "update", "members", JSON.stringify({ id: dupe.id }), JSON.stringify({ handle: `cy-${run}` })));
  assert.deepEqual([taken.error.status, taken.error.code, taken.error.pointer], [409, "unique_violation", "/handle"], "trusted writes still enforce unique usermeta");
  // Uniqueness compares the stored (SCF) form: a date is kept as Ymd.
  const sameDay = JSON.parse(wpTry("first", "update", "members", JSON.stringify({ id: dupe.id }), JSON.stringify({ joined: "2026-01-02" })));
  assert.deepEqual([sameDay.error.status, sameDay.error.pointer], [409, "/joined"]);
  // A member's role is the one First authenticates them with: a contributor is an author.
  wp("user", "set-role", String(dupe.id), "contributor");
  const asContributor = await call("GET", "/me", { token: (await signIn(dupe.email, dupe.password)).json.access_token });
  assert.equal(asContributor.json.data.role, "author", "the WordPress contributor is First's author, as user and member");
  const byRole = JSON.parse(wp("first", "find", "members", JSON.stringify({ where: { id: dupe.id, role: "author" } })));
  assert.deepEqual(byRole.data.map((r: any) => r.id), [dupe.id], "filters on role decide it as authentication does");
  // Capabilities granted or denied to the user directly count the same way.
  wp("user", "set-role", String(dupe.id), "subscriber");
  wp("user", "add-cap", String(dupe.id), "manage_options");
  const granted = JSON.parse(wp("first", "find", "members", JSON.stringify({ where: { id: dupe.id } })));
  assert.equal(granted.data[0].role, "admin", "a direct grant of manage_options makes an admin");
  wp("user", "remove-cap", String(dupe.id), "manage_options");
  wp("user", "set-role", String(dupe.id), "editor");
  wp("eval", `$u = new WP_User(${dupe.id}); $u->add_cap('edit_others_posts', false);`);
  const denied = JSON.parse(wp("first", "find", "members", JSON.stringify({ where: { id: dupe.id, role: "author" } })));
  assert.deepEqual(denied.data.map((r: any) => r.role), ["author"], "an editor denied edit_others_posts is an author, in filters too");
  wp("eval", `$u = new WP_User(${dupe.id}); $u->remove_cap('edit_others_posts'); $u->set_role('contributor'); $u->add_cap('edit_posts', false);`);
  const contributorDenied = JSON.parse(wp("first", "find", "members", JSON.stringify({ where: { id: dupe.id, role: "subscriber" } })));
  assert.deepEqual(contributorDenied.data.map((r: any) => r.role), ["subscriber"], "a contributor denied edit_posts holds no author capability: a subscriber");
  const authRole = wp("eval", `echo \\First\\Wp\\WpAuth::map(new WP_User(${dupe.id}))['role'];`);
  assert.equal(authRole, "subscriber", "the same answer authentication gives");
  // Several roles, one granting and a later one denying manage_options: rows follow WordPress's merge.
  wp("eval", `add_role('first_test_deny', 'Deny', ['manage_options' => false]); $u = new WP_User(${dupe.id}); $u->set_role('administrator'); $u->add_role('first_test_deny');`);
  const authenticated = wp("eval", `echo \\First\\Wp\\WpAuth::map(new WP_User(${dupe.id}))['role'];`);
  const merged = JSON.parse(wp("first", "find", "members", JSON.stringify({ where: { id: dupe.id, role: authenticated } })));
  assert.equal(merged.data[0]?.role, authenticated, "rows and role filters follow WordPress's ordered merge");
  assert.notEqual(authenticated, "admin", "the later role's denial wins, as in WordPress");
  wp("eval", `$u = new WP_User(${dupe.id}); $u->remove_role('first_test_deny'); $u->set_role('subscriber'); remove_role('first_test_deny');`);
  // Capability changes that don't go through a role assignment still move the stored role.
  wp("eval", `$u = new WP_User(${dupe.id}); $u->set_role('administrator'); $u->remove_all_caps();`);
  assert.equal(JSON.parse(wp("first", "find", "members", JSON.stringify({ where: { id: dupe.id } }))).data[0].role, "subscriber", "remove_all_caps");
  wp("user", "set-role", String(dupe.id), "contributor");
  wp("cap", "remove", "contributor", "edit_posts");
  try {
    assert.equal(JSON.parse(wp("first", "find", "members", JSON.stringify({ where: { id: dupe.id, role: "subscriber" } }))).data.length, 1, "a role definition edit");
  } finally {
    wp("cap", "add", "contributor", "edit_posts");
  }
  assert.equal(JSON.parse(wp("first", "find", "members", JSON.stringify({ where: { id: dupe.id } }))).data[0].role, "author", "and back");
  wp("user", "set-role", String(dupe.id), "subscriber");
});

test("a hosted sign-up (no First create) is a member with the collection's defaults", async () => {
  const email = `hosted-${run}@example.test`;
  const start = await fetch(`${site}/wp-json/first-identity/v1/sign-in/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: site }, body: JSON.stringify({ email }),
  });
  const { data: { challenge_id } } = await start.json();
  const code = /Your code is (\d{6})/.exec(wp("eval", `echo file_get_contents(WP_CONTENT_DIR . '/first-test-mail/' . sanitize_file_name(${JSON.stringify(email)}) . '.txt');`))?.[1];
  const verify = await fetch(`${site}/wp-json/first-identity/v1/sign-in/verify`, {
    method: "POST", headers: { "content-type": "application/json", origin: site }, body: JSON.stringify({ challenge_id, code }),
  });
  assert.deepEqual(await verify.json(), { data: { kind: "signed_in" } });
  const id = Number(sql(`SELECT ID FROM wp_users WHERE user_email = '${email}'`)[0].ID);
  const row = JSON.parse(wp("first", "find", "members", JSON.stringify({ where: { id } })));
  assert.deepEqual([row.data[0].plan, row.data[0].points, row.data[0].tags], ["free", 0, []]);
});

test("existing WordPress users become members with defaults when the app (re)activates", () => {
  const id = wp("user", "create", `before-${run}`, `before-${run}@example.test`, "--porcelain");
  wp("user", "meta", "delete", id, "first_plan");
  wp("plugin", "deactivate", "first-app-blog");
  wp("plugin", "activate", "first-app-blog");
  assert.equal(wp("user", "meta", "get", id, "first_plan"), "free");
});

test("a rolled-back member update leaves no usermeta in WordPress's cache", () => {
  const out = wp("eval", `
    $plugin = \\First\\Wp\\Runtime::plugin(); $db = $plugin->app()->db;
    $id = $db->insert('members', ['email' => 'rb-${run}@example.test', 'name' => 'rb'], true)[0]['id'];
    try { $db->transaction(function () use ($db, $id) {
      $db->update('members', ['points' => 99], ['id' => $id]);
      get_user_meta($id, 'first_points', true); // a hook reads the new value
      throw new RuntimeException('rollback');
    }); } catch (RuntimeException $e) {}
    echo get_user_meta($id, 'first_points', true);`);
  assert.equal(out, "0");
});

test("member showIf on profile forms: live rules on member fields, core-column rules settled on the saved member", () => {
  const id = wp("user", "create", `form-${run}`, `form-${run}@example.test`, "--porcelain", "--display_name=Plain");
  // What SCF's profile form renders: each member field after acf/prepare_field, for that user.
  const rendered = (user: string) => JSON.parse(wp("eval", [
    `wp_set_current_user(${user});`,
    `acf_set_form_data(['post_id' => 'user_${user}']);`,
    "$out = [];",
    "foreach (acf_get_fields('group_first_members') as $f) {",
    "  $p = apply_filters('acf/prepare_field', $f);",
    "  $out[$f['name']] = $p === false ? 'hidden' : ($p['conditional_logic'] ?: 0);",
    "}",
    "echo wp_json_encode(['perk' => $out['first_perk'], 'badge' => $out['first_badge'], 'sponsored' => $out['first_sponsored'], 'sections' => $out['first_sections'], 'fields' => array_keys($out)]);",
  ].join("\n")));
  const plain = rendered(id);
  assert.deepEqual(plain.perk, [[{ field: "field_first_member_plan", operator: "==", value: "pro" }]], "a rule on a member field stays live for SCF");
  assert.deepEqual(plain.sections, [[{ field: "field_first_member_plan", operator: "==", value: "pro" }]], "a structured member field's showIf is live too");
  assert.equal(plain.badge, "hidden", "a rule on the core name column is settled against the saved member: not shown");
  assert.equal(plain.fields.includes("first_sponsorId"), false, "references aren't profile fields");
  assert.equal(plain.sponsored, "hidden", "a rule on a non-profile column is settled against the saved member, never watching a missing field");
  wp("user", "update", id, "--display_name=Cy Edited");
  assert.equal(rendered(id).badge, 0, "once the saved name matches, the field shows unconditionally");
});

/** A wp-admin session for a WordPress login: cookies, as the browser holds them after signing in. */
async function adminCookie(login: string, password: string): Promise<string> {
  // Polylang sends the first wp-admin request within 30s of activation to its setup wizard.
  wp("transient", "delete", "pll_activation_redirect");
  const res = await fetch(`${site}/wp-login.php`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "wordpress_test_cookie=WP%20Cookie%20check" },
    body: new URLSearchParams({ log: login, pwd: password, testcookie: "1" }),
  });
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const decode = (v: string) => v.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * Every control of the profile form as a browser submits it: text-like inputs and hidden inputs with
 * their values, checked boxes, the selected options, textareas. SCF's repeater/blocks templates
 * (`acfcloneindex`) are skipped, as SCF's script disables them before submitting.
 */
function successfulControls(html: string): [string, string][] {
  const form = html.slice(html.indexOf('<form id="your-profile"'), html.indexOf("</form>", html.indexOf('<form id="your-profile"')));
  const out: [string, string][] = [];
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}=(["'])(.*?)\\1`, "s"))?.[2];
  for (const [tag] of form.matchAll(/<input\b[^>]*>/gs)) {
    const name = attr(tag, "name");
    const type = (attr(tag, "type") ?? "text").toLowerCase();
    if (!name || /\bdisabled\b/.test(tag) || name.includes("acfcloneindex") || ["submit", "button", "file", "image", "reset"].includes(type)) continue;
    if ((type === "checkbox" || type === "radio") && !/\bchecked\b/.test(tag)) continue;
    if (type === "password") continue; // left blank: no password change
    out.push([decode(name), decode(attr(tag, "value") ?? (type === "checkbox" ? "on" : ""))]);
  }
  for (const [, open, body] of form.matchAll(/<select\b([^>]*)>(.*?)<\/select>/gs)) {
    const name = attr(open, "name");
    if (!name || /\bdisabled\b/.test(open) || name.includes("acfcloneindex")) continue;
    const options = [...body.matchAll(/<option\b([^>]*)>(.*?)<\/option>/gs)];
    const chosen = options.filter(([, a]) => /\bselected\b/.test(a));
    for (const [, a, label] of chosen.length > 0 || /\bmultiple\b/.test(open) ? chosen : options.slice(0, 1)) out.push([decode(name), decode(attr(a, "value") ?? label)]);
  }
  for (const [, open, body] of form.matchAll(/<textarea\b([^>]*)>(.*?)<\/textarea>/gs)) {
    const name = attr(open, "name");
    if (name && !name.includes("acfcloneindex")) out.push([decode(name), decode(body)]);
  }
  return out;
}

/**
 * Load a profile screen and submit it as the browser does: every control as rendered, with `set`
 * replacing (or adding) the named controls and `drop` removing them (a repeater row deleted).
 */
async function saveProfile(cookie: string, screen: string, set: Record<string, string> = {}, drop: (name: string) => boolean = () => false, renderedHtml?: string) {
  let html = renderedHtml;
  if (html === undefined) {
    const page = await fetch(`${site}/wp-admin/${screen}`, { headers: { cookie }, redirect: "manual" });
    assert.equal(page.status, 200, `${screen} didn't render: ${page.status} ${page.headers.get("location") ?? ""}`);
    html = await page.text();
  }
  const controls = successfulControls(html).filter(([name]) => !(name in set) && !drop(name));
  // Each set control goes where the browser would put it: right after the controls of the field it
  // belongs to (SCF's empty placeholder for a list comes first, its rows after it, so PHP keeps the rows).
  const body = [...controls];
  for (const [name, value] of Object.entries(set)) {
    let at = body.length;
    for (let prefix = name; prefix.includes("["); prefix = prefix.slice(0, prefix.lastIndexOf("["))) {
      const last = body.findLastIndex(([n]) => n === prefix || n.startsWith(prefix + "["));
      if (last >= 0) {
        at = last + 1;
        break;
      }
    }
    body.splice(at, 0, [name, value]);
  }
  const nonce = html.match(/acf\.data = .*?"nonce":"([^"]+)"/)?.[1];
  if (!nonce) throw new Error("SCF validation nonce is missing from the profile screen");
  const validationBody = new URLSearchParams(body);
  validationBody.set("action", "acf/validate_save_post");
  validationBody.set("nonce", nonce);
  const validationRes = await fetch(`${site}/wp-admin/admin-ajax.php`, {
    method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: validationBody,
  });
  const validation = await validationRes.json();
  assert.equal(validation.success, true, JSON.stringify(validation));
  if (validation.data.valid !== 1) return { status: validationRes.status, html, text: JSON.stringify(validation.data.errors) };
  const res = await fetch(`${site}/wp-admin/${screen.split("?")[0]}`, {
    method: "POST", redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const responseHtml = res.status === 302 ? html : await res.text();
  const text = res.status === 302 ? "" : responseHtml.replace(/<style[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return { status: res.status, html: responseHtml, text };
}

/** `acf[...]` control name: field names are prefixed with the member field key; row ids and SCF's own keys aren't. */
const acf = (...keys: string[]) => `acf${keys.map((k) => `[${k.startsWith("row-") || k === "acf_fc_layout" ? k : `field_first_member_${k}`}]`).join("")}`;
const memberRow = (id: number) => JSON.parse(wp("first", "find", "members", JSON.stringify({ where: { id } }))).data[0];

/** A member signed into wp-admin with their own password. */
async function profileMember(tag: string) {
  const m = await member(tag);
  return { ...m, cookie: await adminCookie(wp("user", "get", String(m.id), "--field=user_login"), m.password) };
}

test("structured member fields render on the member's own profile, but not on the add-user form", async () => {
  const gu = await profileMember("gu");
  const page = await (await fetch(`${site}/wp-admin/profile.php`, { headers: { cookie: gu.cookie } })).text();
  for (const name of ["first_address", "first_links", "first_sections"]) assert.match(page, new RegExp(`data-name="${name}"`), name);
  assert.deepEqual(successfulControls(page).find(([name]) => name === acf("address", "address_source")), [acf("address", "address_source"), "signup"], "new groups render their non-boolean defaults");
  assert.doesNotMatch(page, /data-name="first_notes"/, "a group holding a sub-field the member can't read isn't rendered");
  // The collection's read rule ("self") decides the form too: an admin editing this member sees none of its fields.
  wp("eval", `\\First\\Wp\\Runtime::plugin()->db()->update('members', ['address' => ['city' => 'Oslo']], ['id' => ${gu.id}]);`);
  const asAdmin = await (await fetch(`${site}/wp-admin/user-edit.php?user_id=${gu.id}`, { headers: { cookie: await adminCookie("admin", "first-test-admin") } })).text();
  assert.match(asAdmin, /name="nickname"/, "the screen itself renders");
  assert.doesNotMatch(asAdmin, /data-name="first_/, "no member field, so no member value");
  assert.doesNotMatch(asAdmin, /Oslo/);
  const addForm = await (await fetch(`${site}/wp-admin/user-new.php`, { headers: { cookie: await adminCookie("admin", "first-test-admin") } })).text();
  assert.match(addForm, /data-name="first_plan"/);
  assert.doesNotMatch(addForm, /data-name="first_(address|links|sections)"/, "no checked path creates users with structured values");
});

test("a profile save writes structured fields through First, in First's storage form and UTC", async () => {
  const hu = await profileMember("hu");
  // An untouched save of the whole form changes nothing and runs no member hook.
  const untouched = await saveProfile(hu.cookie, "profile.php");
  assert.equal(untouched.status, 302, untouched.text.slice(0, 400));
  assert.deepEqual([memberRow(hu.id).address, memberRow(hu.id).links, memberRow(hu.id).addressBy], [null, null, null], "never set, still unset");
  // The date picker posts site time; First keeps UTC (Berlin is UTC+2 in July).
  wp("option", "update", "timezone_string", "Europe/Berlin");
  try {
    const saved = await saveProfile(hu.cookie, "profile.php", {
      display_name: "Profile name",
      [acf("address", "address_city")]: "Oslo",
      [acf("links", "row-0", "links_label")]: "visible",
      [acf("links", "row-0", "links_detail")]: "Site detail",
      [acf("links", "row-0", "links_metadata", "links_metadata_bio")]: "",
      [acf("plan")]: "pro",
      [acf("links", "row-0", "links_at")]: "2026-07-01 14:30:00",
      [acf("sections", "row-0", "acf_fc_layout")]: "bio",
      [acf("sections", "row-0", "sections_bio_body")]: "Hello",
    });
    assert.equal(saved.status, 302, saved.text.slice(0, 400));
    const row = memberRow(hu.id);
    assert.deepEqual([row.address, row.links, row.sections], [
      { city: "Oslo", source: "signup", defaults: { clock: { at: "2026-10-25T00:30:00.123Z" } }, channel: "member", since: "2026-10-25T00:30:00.123Z", verified: false, optional: true, prefs: null, district: null },
      [{ label: "visible", at: "2026-07-01T12:30:00.000Z", detail: "Site detail", metadata: { bio: null } }],
      [{ layout: "bio", body: "Hello" }],
    ]);
    assert.deepEqual(JSON.parse(wp("first", "find", "member_updates", JSON.stringify({ where: { memberId: hu.id } }))).data.map(({ name, city }: { name: string; city: string | null }) => ({ name, city })),
      [{ name: "Profile name", city: "Oslo" }], "afterUpdate sees the new core and structured fields together");
    assert.equal(row.addressBy, hu.id, "the member hook saw the signed-in member as ctx.user");
    assert.deepEqual(JSON.parse(sql(`SELECT meta_value FROM wp_usermeta WHERE user_id = ${hu.id} AND meta_key = 'first_address'`)[0].meta_value),
      { city: "Oslo", source: "signup", defaults: { clock: { at: "2026-10-25T00:30:00.123Z" } }, channel: "member", since: "2026-10-25T00:30:00.123Z", verified: false, optional: true, prefs: null, district: null }, "one usermeta row in First's storage form, as the API writes it");
    // The form shows the saved values back in site time, so saving it again unchanged is a no-op.
    const again = await saveProfile(hu.cookie, "profile.php");
    assert.match(again.html, /value="2026-07-01 14:30:00"/);
    assert.equal(again.status, 302, again.text.slice(0, 400));
    assert.deepEqual(memberRow(hu.id).links, row.links);
    const changedTime = await saveProfile(hu.cookie, "profile.php", { [acf("links", "row-0", "links_at")]: "2026-07-01 12:30:00" });
    assert.equal(changedTime.status, 302, changedTime.text.slice(0, 400));
    assert.equal(memberRow(hu.id).links[0].at, "2026-07-01T10:30:00.000Z", "editing the wall clock to the saved UTC hour is still an edit");
  } finally {
    wp("option", "update", "timezone_string", "");
  }
  // Saved instants the picker can't show exactly survive an untouched save: milliseconds, and the
  // hour the end of summer time repeats (00:30 and 01:30 UTC both show as 02:30 in Berlin).
  // A sub-field SCF doesn't post (its showIf hides it) keeps its value.
  wp("eval", `\\First\\Wp\\Runtime::plugin()->db()->update('members', ['address' => ['city' => 'Bergen', 'district' => 'Sentrum', 'optional' => null], 'links' => [['label' => 'ms', 'at' => '2026-07-01T12:30:00.123Z', 'detail' => 'MS detail', 'metadata' => ['bio' => null]], ['label' => 'dst', 'at' => '2026-10-25T01:30:00.000Z', 'detail' => 'DST detail', 'metadata' => ['bio' => null]]], 'sections' => [['layout' => 'quote', 'text' => 'A', 'cite' => 'A cite'], ['layout' => 'quote', 'text' => 'B', 'cite' => 'B cite']]], ['id' => ${hu.id}]);`);
  wp("option", "update", "timezone_string", "Europe/Berlin");
  try {
    const hidden = (name: string) => name === acf("address", "address_district") || name.endsWith("[field_first_member_links_detail]") || name.endsWith("[field_first_member_sections_quote_cite]");
    const kept = await saveProfile(hu.cookie, "profile.php", {}, hidden);
    assert.equal(kept.status, 302, kept.text.slice(0, 400));
    assert.deepEqual(memberRow(hu.id).links, [
      { label: "ms", at: "2026-07-01T12:30:00.123Z", detail: "MS detail", metadata: { bio: null } },
      { label: "dst", at: "2026-10-25T01:30:00.000Z", detail: "DST detail", metadata: { bio: null } },
    ]);
    // Deleting the first row keeps the surviving row's own hidden values, not its predecessor's.
    const deleted = await saveProfile(hu.cookie, "profile.php", {}, (name) => hidden(name) || name.startsWith(acf("links", "row-0")) || name.startsWith(acf("sections", "row-0")));
    assert.equal(deleted.status, 302, deleted.text.slice(0, 400));
    assert.deepEqual(memberRow(hu.id).sections, [{ layout: "quote", text: "B", cite: "B cite" }]);
  } finally {
    wp("option", "update", "timezone_string", "");
  }
  assert.deepEqual([memberRow(hu.id).address, memberRow(hu.id).links], [
    { city: "Bergen", source: "signup", defaults: { clock: { at: "2026-10-25T00:30:00.123Z" } }, channel: "member", since: "2026-10-25T00:30:00.123Z", verified: false, optional: null, prefs: null, district: "Sentrum" },
    [{ label: "dst", at: "2026-10-25T01:30:00.000Z", detail: "DST detail", metadata: { bio: null } }],
  ]);
  // Removing the last repeater row empties the list.
  const emptied = await saveProfile(hu.cookie, "profile.php", { [acf("links")]: "" }, (name) => name.startsWith(acf("links") + "["));
  assert.equal(emptied.status, 302, emptied.text.slice(0, 400));
  assert.deepEqual(memberRow(hu.id).links, []);
  const hooked = await saveProfile(hu.cookie, "profile.php", { display_name: "Name from form", [acf("address", "address_city")]: "Hooked" });
  assert.equal(hooked.status, 302, hooked.text.slice(0, 400));
  assert.equal(memberRow(hu.id).name, "Name from hook", "beforeUpdate core-field mutations apply after core's form write");
  const updates = JSON.parse(wp("first", "find", "member_updates", JSON.stringify({ where: { memberId: hu.id }, orderBy: { id: "asc" } }))).data;
  assert.deepEqual([updates.at(-1).name, updates.at(-1).city], ["Name from hook", "Hooked"], "afterUpdate observes the hook's final core value too");
});

test("a refused profile save keeps nothing, core's user fields included, and answers with First's reason", async () => {
  const iu = await profileMember("iu");
  await saveProfile(iu.cookie, "profile.php", { [acf("address", "address_city")]: "Oslo" });
  const name = () => sql(`SELECT display_name FROM wp_users WHERE ID = ${iu.id}`)[0].display_name;
  const before = name();
  const nickname = wp("user", "meta", "get", String(iu.id), "nickname");
  // Field access: an admin-only sub-field, set from the member's own form.
  const forged = await saveProfile(iu.cookie, "profile.php", { [acf("address", "address_verified")]: "1", nickname: "Forged" });
  assert.equal(forged.status, 403);
  assert.match(forged.text, /verified/);
  // A field the form never rendered is refused whatever is posted, so a guess can't probe its value.
  wp("eval", `\\First\\Wp\\Runtime::plugin()->db()->update('members', ['notes' => ['private' => 'secret']], ['id' => ${iu.id}]);`);
  for (const guess of ["secret", "wrong", ""]) {
    const probe = await saveProfile(iu.cookie, "profile.php", { [acf("notes", "notes_private")]: guess });
    assert.equal(probe.status, 403, `guess ${JSON.stringify(guess)}`);
  }
  // A surrounding Db cannot replace the plugin's profile field policy.
  const profileHtml = await (await fetch(`${site}/wp-admin/profile.php`, { headers: { cookie: iu.cookie } })).text();
  const scopedBody = new URLSearchParams(successfulControls(profileHtml));
  scopedBody.set(acf("notes", "notes_private"), "replacement");
  const encoded = Buffer.from(scopedBody.toString()).toString("base64");
  const scoped = JSON.parse(wp("eval", `
    parse_str(str_replace('; ', '&', base64_decode('${Buffer.from(iu.cookie).toString("base64")}')), $_COOKIE);
    wp_set_current_user(${iu.id});
    parse_str(base64_decode('${encoded}'), $_POST);
    $app = \\First\\Wp\\Plugin::instance()->db();
    $spec = $app->schema()->collection('members');
    unset($spec['columns']['notes']['fields']['private']['access']);
    $schema = new \\First\\Schema(['collections' => ['members' => $spec]]);
    $other = new \\First\\Db($app->store(), $schema, $app->media(), 'wp');
    add_filter('wp_die_handler', static fn () => static function ($message, $title, $args): never {
      throw new \\First\\HttpError((int) ($args['response'] ?? 500), (string) ($args['code'] ?? 'error'), strip_tags($message));
    });
    $status = 200;
    try { $other->current(static fn () => \\First\\Wp\\ProfileForm::begin(${iu.id})); \\First\\Wp\\ProfileForm::end(${iu.id}); }
    catch (\\First\\HttpError $error) { $status = $error->status; }
    echo wp_json_encode([$status, \\First\\db() === $app]);
  `));
  assert.deepEqual(scoped, [403, true]);
  assert.deepEqual(memberRow(iu.id).notes, { private: "secret" });
  // The same answer when nothing is stored there.
  const empty = await profileMember("iv");
  assert.equal((await saveProfile(empty.cookie, "profile.php", { [acf("notes", "notes_private")]: "" })).status, 403);
  assert.equal(memberRow(empty.id).notes, null);
  // A hook's unique value keeps the profile viewer, although the original-row authorization is done.
  const prefix = `oracle-${run}-`;
  wp("eval", `\\First\\Wp\\Plugin::instance()->db()->update('members', ['handle' => '${prefix}taken'], ['id' => ${empty.id}]);`);
  const hook = `<?php add_action('first_runtime_loaded', static function (): void {
    \\First\\Extensions::onWrite(static function (string $op, string $collection, array &$data): void {
      $city = $data['address']['city'] ?? null;
      if ($op === 'update' && $collection === 'members' && is_string($city) && str_starts_with($city, '${prefix}')) $data['handle'] = $city;
    });
  });`;
  wp("eval", `file_put_contents(WPMU_PLUGIN_DIR . '/r-profile-oracle.php', base64_decode('${Buffer.from(hook).toString("base64")}'));`);
  try {
    for (const suffix of ["taken", "free"]) {
      const generated = await saveProfile(iu.cookie, "profile.php", { [acf("address", "address_city")]: prefix + suffix, nickname: "Oracle probe" });
      assert.equal(generated.status, 403, generated.text);
      assert.match(generated.text, /handle/);
      assert.deepEqual([memberRow(iu.id).handle, wp("user", "meta", "get", String(iu.id), "nickname")], [null, nickname]);
    }
  } finally {
    wp("eval", "unlink(WPMU_PLUGIN_DIR . '/r-profile-oracle.php');");
  }
  // First still enforces required children after reconciling the effective group values.
  const missing = await saveProfile(iu.cookie, "profile.php", {
    [acf("links", "row-0", "links_label")]: "visible",
    [acf("links", "row-0", "links_metadata", "links_metadata_bio")]: "",
  });
  assert.equal(missing.status, 200);
  assert.match(missing.text, /detail is required/);
  // Validation: the repeater's max(3).
  const tooMany = await saveProfile(iu.cookie, "profile.php", Object.fromEntries([0, 1, 2, 3].flatMap((i) => [[acf("links", `row-${i}`, "links_label"), `L${i}`], [acf("links", `row-${i}`, "links_detail"), `D${i}`], [acf("links", `row-${i}`, "links_metadata", "links_metadata_bio"), ""]])));
  assert.notEqual(tooMany.status, 302);
  assert.match(tooMany.text, /links must have at most 3 items/);
  // A member hook that throws.
  const thrown = await saveProfile(iu.cookie, "profile.php", { [acf("address", "address_city")]: "Throw", nickname: "Thrown" });
  assert.deepEqual([thrown.status, /address hook refused/.test(thrown.text)], [409, true]);
  assert.deepEqual([name(), wp("user", "meta", "get", String(iu.id), "nickname")], [before, nickname], "core's user update rolled back with it");
  assert.deepEqual([memberRow(iu.id).address, memberRow(iu.id).links, memberRow(iu.id).notes], [{ city: "Oslo", source: "signup", defaults: { clock: { at: "2026-10-25T00:30:00.123Z" } }, channel: "member", since: "2026-10-25T00:30:00.123Z", verified: false, optional: true, prefs: null, district: null }, null, { private: "secret" }]);
  // A real failed upgrade must refuse the form, never fall through to the trusted-code write path.
  const rendered = await (await fetch(`${site}/wp-admin/profile.php`, { headers: { cookie: iu.cookie } })).text();
  const appDir = fileURLToPath(new URL(`.wp-content/plugins/${harness.plugin}/first/app/`, import.meta.url));
  const schema = readFileSync(appDir + "schema.php");
  writeFileSync(appDir + "migrations/9998_profile_probe.sql", "INSERT INTO `{prefix}missing_profile_table` (`n`) VALUES (1);\n");
  appendFileSync(appDir + "schema.php", "\n// profile upgrade probe\n");
  const waitForStatus = async (status: number) => {
    const deadline = Date.now() + 30_000;
    while ((await fetch(`${api}/posts?limit=1`)).status !== status) {
      assert.ok(Date.now() < deadline, `upgrade did not reach HTTP ${status}`);
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  try {
    await waitForStatus(503);
    const unavailable = await saveProfile(iu.cookie, "profile.php", { [acf("address", "address_verified")]: "1", nickname: "Unavailable" }, () => false, rendered);
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.text, /Storage is being upgraded/);
  } finally {
    rmSync(appDir + "migrations/9998_profile_probe.sql");
    writeFileSync(appDir + "schema.php", schema);
    await waitForStatus(200);
  }
  assert.deepEqual([memberRow(iu.id).address.verified, wp("user", "meta", "get", String(iu.id), "nickname")], [false, nickname]);

});

test("a profile save core rejects (mismatched passwords) keeps nothing, member fields included", async () => {
  const ku = await profileMember("ku");
  wp("eval", `\\First\\Wp\\Runtime::plugin()->db()->update('members', ['links' => [['label' => 'hidden', 'detail' => 'Saved detail', 'metadata' => ['bio' => null]]]], ['id' => ${ku.id}]);`);
  const hidden = (name: string) => name.endsWith("[field_first_member_links_detail]");
  const rejected = await saveProfile(ku.cookie, "profile.php", { [acf("address", "address_city")]: "Paris", pass1: "new-password-one", pass2: "new-password-two" }, hidden);
  assert.equal(rejected.status, 200, "core shows the form again with its error");
  assert.match(rejected.text, /passwords do not match/i);
  assert.equal(memberRow(ku.id).address, null, "the member field staged before core refused is gone");
  // Submit the redisplayed error form itself: SCF has prefixed its submitted row keys again.
  const next = await saveProfile(ku.cookie, "profile.php", { [acf("address", "address_city")]: "Lyon" }, hidden, rejected.html);
  assert.equal(next.status, 302, next.text.slice(0, 400));
  assert.equal(memberRow(ku.id).address.city, "Lyon");
  assert.deepEqual(memberRow(ku.id).links, [{ label: "hidden", at: null, detail: "Saved detail", metadata: { bio: null } }]);
});

test("the update rule decides profile saves: an admin is refused another member under \"self\", and sets admin-only fields on their own", async () => {
  const ju = await profileMember("ju");
  const admin = await adminCookie("admin", "first-test-admin");
  const other = await saveProfile(admin, `user-edit.php?user_id=${ju.id}`, { [acf("address", "address_city")]: "Bergen" });
  assert.equal(other.status, 403);
  assert.match(other.text, /update members rows/);
  assert.equal((await http("PATCH", `${api}/members/${ju.id}`, { as: "admin", body: { address: { city: "Bergen" } } })).status, 404, "the API's answer to the same write");
  assert.equal(memberRow(ju.id).address, null);
  // The same request cannot change a core column to make the original row pass its update rule.
  const denied = await saveProfile(ju.cookie, "profile.php", { display_name: "Unlocked", [acf("address", "address_city")]: "Gated" });
  assert.equal(denied.status, 403);
  assert.deepEqual([memberRow(ju.id).name, memberRow(ju.id).address], ["ju", null]);
  wp("user", "update", String(ju.id), "--display_name=Unlocked");
  const allowed = await saveProfile(ju.cookie, "profile.php", { display_name: "Locked again", [acf("address", "address_city")]: "Gated" });
  assert.equal(allowed.status, 302, allowed.text.slice(0, 400));
  assert.deepEqual([memberRow(ju.id).name, memberRow(ju.id).address.city], ["Locked again", "Gated"], "authorization uses the original row even when the saved row no longer matches");
  const own = await saveProfile(admin, "profile.php", { [acf("address", "address_city")]: "Rome", [acf("address", "address_verified")]: "1" });
  assert.equal(own.status, 302, own.text.slice(0, 400));
  assert.deepEqual(memberRow(harness.users.admin.id).address, { city: "Rome", source: "signup", defaults: { clock: { at: "2026-10-25T00:30:00.123Z" } }, channel: "member", since: "2026-10-25T00:30:00.123Z", verified: true, optional: true, prefs: null, district: null });
});

test("update_field on a structured member field is a trusted First write; get_field reads it back by name", () => {
  const id = wp("user", "create", `code-${run}`, `code-${run}@example.test`, "--porcelain");
  wp("option", "update", "timezone_string", "Europe/Berlin");
  try {
    const out = JSON.parse(wp("eval", [
      `$before = get_field('first_links', 'user_${id}');`,
      `update_field('field_first_member_links', [['field_first_member_links_label' => 'Code', 'field_first_member_links_detail' => 'Code detail', 'field_first_member_links_metadata' => ['field_first_member_links_metadata_bio' => ''], 'field_first_member_links_at' => '2026-07-01 14:30:00']], 'user_${id}');`,
      `echo wp_json_encode(['before' => $before, 'after' => get_field('first_links', 'user_${id}', false)]);`,
    ].join("\n")));
    assert.deepEqual(out, { before: false, after: [{ field_first_member_links_label: "Code", field_first_member_links_detail: "Code detail", field_first_member_links_metadata: { field_first_member_links_metadata_bio: "" }, field_first_member_links_at: "2026-07-01 14:30:00" }] },
      "same request: no stale SCF cache (an empty repeater formats as false), and the name resolves without SCF's reference meta");
    // An impossible date isn't laundered into a valid one by the timezone conversion.
    const bad = wp("eval", `try { update_field('field_first_member_links', [['field_first_member_links_label' => 'X', 'field_first_member_links_at' => '2026-02-30 10:00:00']], 'user_${id}'); echo 'saved'; } catch (\\First\\HttpError $e) { echo $e->status; }`);
    assert.equal(bad, "422");
  } finally {
    wp("option", "update", "timezone_string", "");
  }
  assert.deepEqual(memberRow(Number(id)).links, [{ label: "Code", at: "2026-07-01T12:30:00.000Z", detail: "Code detail", metadata: { bio: null } }]);
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
  const cleared = await http("PATCH", `${api}/members/1`, { as: "admin", body: { role: null } });
  assert.deepEqual([cleared.status, cleared.json?.pointer], [422, "/role"], "even an admin can't clear a role");
  assert.equal((await call("GET", "/members/1", asSelf)).status, 404, "another user's row is not this member's");
});

test("identity work joins the First transaction: a rollback leaves no guest, tokens or cached user", () => {
  // Inside one First transaction: create a guest (WordPress user + first-identity session and tokens),
  // read it, then fail. Nothing may survive, and the object cache must not remember the user.
  const out = wp("eval", `
    $plugin = \\First\\Wp\\Runtime::plugin(); $app = $plugin->app(); $db = $plugin->connection();
    global $wpdb; $before = (int) $wpdb->get_var("SELECT MAX(ID) FROM {$wpdb->users}");
    try { $db->transaction(function () use ($app, &$id) {
        $id = $app->invoke('POST', '/auth/guest', [], '{}', new \\First\\Viewer(null, 'wp'))['user']['id'];
        get_userdata($id);
        throw new RuntimeException('rollback');
    }); } catch (RuntimeException $e) {}
    echo json_encode([
      'users' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->users} WHERE ID > $before"),
      'tokens' => (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$wpdb->prefix}first_identity_tokens WHERE wp_user_id=%d", $id)),
      'cached' => get_userdata($id) !== false,
    ]);`);
  assert.deepEqual(JSON.parse(out), { users: 0, tokens: 0, cached: false });
});

test("activation refuses user tables that can't roll back with First (auth rows live there)", () => {
  // MyISAM wp_usermeta would keep member or guest writes through a rollback: the storage gate
  // reports it whether or not the app has an auth collection (guests are users either way).
  sql("ALTER TABLE wp_usermeta ENGINE=MyISAM");
  try {
    const bad = JSON.parse(wp("eval", `echo wp_json_encode(\\First\\Wp\\Runtime::plugin()->storageProblems());`));
    assert.ok(bad.includes("wp_usermeta"), JSON.stringify(bad));
  } finally {
    sql("ALTER TABLE wp_usermeta ENGINE=InnoDB");
  }
  const ok = JSON.parse(wp("eval", `echo wp_json_encode(\\First\\Wp\\Runtime::plugin()->storageProblems());`));
  assert.deepEqual(ok, []);
});

test("without first-identity, a member's password still goes through wp_set_password", () => {
  const out = wp("eval", `
    $db = \\First\\Wp\\Runtime::plugin()->app()->db;
    \\First\\Auth\\Module::use(null); // as when first-identity is inactive
    $id = $db->insert('members', ['email' => 'noid-${run}@example.test', 'name' => 'noid', 'password' => 'a long password 1'], true)[0]['id'];
    echo wp_check_password('a long password 1', get_userdata($id)->user_pass, $id) ? 'set' : 'unset';`);
  assert.equal(out, "set");
});

test("deleting a member through First deletes its identity: tokens dead, the email signs up afresh", async () => {
  const gy = await member("gy");
  const tokens = await signIn(gy.email, gy.password);
  const del = await http("DELETE", `${api}/members/${gy.id}`, { as: "admin" });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal((await call("GET", "/me", { token: tokens.json.access_token })).status, 401, "its Bearer is dead");
  const reuse = await token({ grant_type: "refresh_token", client_id: app.id, refresh_token: tokens.json.refresh_token });
  assert.equal(reuse.status, 400, "its refresh token is dead");
  assert.deepEqual(sql(`SELECT COUNT(*) AS n FROM wp_first_identity_emails WHERE normalized = '${gy.email}'`), [{ n: "0" }], "its verified email is released");
});

test("a member can't set their own email where identity verifies emails; trusted writes can", async () => {
  const hy = await member("hy");
  const asSelf = { token: (await signIn(hy.email, hy.password)).json.access_token };
  const claim = await call("PATCH", `/members/${hy.id}`, { ...asSelf, body: { email: `victim-${run}@example.test` } });
  assert.deepEqual([claim.status, claim.json.code, claim.json.pointer], [403, "forbidden", "/email"]);
  // Nor can anyone (even with a public create rule) plant a member on an unverified address.
  const planted = wp("eval", `
    \\First\\Wp\\Runtime::plugin()->app();
    try {
      \\First\\db()->insert('members', ['email' => 'planted-${run}@example.test', 'name' => 'x', 'password' => 'a long password 1'], true, new \\First\\Viewer(null, 'wp'));
      echo 'created';
    } catch (\\First\\HttpError $e) { echo $e->status, ' ', $e->errorCode, ' ', $e->pointer, ' ', $e->getMessage(); }`);
  // The verified-email guard runs before the collection's create rule, so a public rule changes nothing.
  assert.equal(planted, "403 forbidden /email Members sign up on the account screen, where emails are verified");
  // Trusted writes (admin tooling, imports: `wp first update`) still set it directly.
  const updated = JSON.parse(wp("first", "update", "members", JSON.stringify({ id: hy.id }), JSON.stringify({ email: `hy-new-${run}@example.test` })));
  assert.equal(updated.data[0].email, `hy-new-${run}@example.test`);
});

test("deleting a member keeps the posts they authored", async () => {
  const iy = await member("iy");
  const post = wp("post", "create", "--post_type=first_posts", "--post_title=Authored", "--post_status=publish", `--post_author=${iy.id}`, "--porcelain");
  await http("DELETE", `${api}/members/${iy.id}`, { as: "admin" });
  assert.deepEqual(sql(`SELECT post_status, post_author FROM wp_posts WHERE ID = ${post}`), [{ post_status: "publish", post_author: "0" }]);
});

test("application passwords still authenticate /__first/api/v1 as before", async () => {
  const me = await fetch(`${api}/me`, { headers: auth("editor") });
  assert.equal((await me.json()).data.role, "editor");
});

test("identity storage failures refuse every authentication path in the runtime", () => {
  const probe = readFileSync(new URL("../identity/native-auth-storage.php", import.meta.url), "utf8").replace(/^<\?php\s*/, "");
  assert.match(wp("eval", probe), /PASS identity storage failures refuse cookie, native password, application password, Bearer\/OAuth and runtime authentication/);
});

// Core /wp/v2/users for the users kind (spec §2.2, §3a): member fields under `meta`, read and
// written through First as the viewer, and First's `where`/`orderBy` on the list.
const coreUsers = `${harness.url}/wp-json/wp/v2/users`;

test("core users meta holds member fields as First reads them, for whoever may read the member", async () => {
  const sub = harness.users.subscriber.id;
  first("update", "members", JSON.stringify({ id: sub }), JSON.stringify({ points: 3, tags: ["early"], notes: { private: "admin only" } }));
  const self = await http("GET", `${coreUsers}/me?context=edit`, { as: "subscriber" });
  assert.equal(self.status, 200, JSON.stringify(self.json));
  assert.deepEqual([self.json.meta.plan, self.json.meta.points, self.json.meta.tags, self.json.meta.notes], ["free", 3, ["early"], {}]);
  assert.doesNotMatch(JSON.stringify(self.json.meta), HIDDEN);
  // `self` read rule: another member's fields are not in core's answer either.
  const other = await http("GET", `${coreUsers}/${sub}?context=edit`, { as: "admin" });
  assert.equal(other.status, 200);
  assert.equal("points" in other.json.meta, false);
  const schema = (await http("OPTIONS", coreUsers, { as: "admin" })).json.schema.properties.meta.properties;
  assert.deepEqual([schema.points.type, schema.tags.items.enum, "passwordHash" in schema], ["integer", ["early", "beta"], false]);
});

test("core users meta writes run First's update: rules, validation, one transaction with core's save", async () => {
  const sub = harness.users.subscriber.id;
  const ok = await http("POST", `${coreUsers}/me`, { as: "subscriber", body: { meta: { points: 11, tags: ["beta"] } } });
  assert.deepEqual([ok.status, ok.json.meta?.points, ok.json.meta?.tags], [200, 11, ["beta"]], JSON.stringify(ok.json));
  assert.deepEqual(sql(`SELECT meta_value FROM wp_usermeta WHERE user_id = ${sub} AND meta_key = 'first_tags'`)[0], { meta_value: 'a:1:{i:0;s:4:"beta";}' });
  const name = sql(`SELECT display_name FROM wp_users WHERE ID = ${sub}`)[0].display_name;
  const bad = await http("POST", `${coreUsers}/me`, { as: "subscriber", body: { name: `Renamed ${run}`, meta: { plan: "gold" } } });
  assert.deepEqual([bad.status, bad.json.code, bad.json.data?.pointer], [422, "invalid_input", "/plan"]);
  assert.equal(sql(`SELECT display_name FROM wp_users WHERE ID = ${sub}`)[0].display_name, name, "core's own change rolled back too");
  // A field only admins may set, and a member the update rule doesn't cover: the facade's answers.
  const sealed = await http("POST", `${coreUsers}/me`, { as: "subscriber", body: { meta: { address: { source: "forged" } } } });
  assert.deepEqual([sealed.status, sealed.json.data?.pointer], [403, "/address/source"]);
  const another = await http("POST", `${coreUsers}/${sub}`, { as: "admin", body: { meta: { points: 99 } } });
  assert.equal(another.status, 404, JSON.stringify(another.json));
  assert.equal(JSON.parse(wp("first", "find", "members", JSON.stringify({ where: { id: sub } }))).data[0].points, 11);
});

test("core users list takes First's where and orderBy as the viewer", async () => {
  const admin = harness.users.admin.id;
  const listed = await http("GET", `${coreUsers}?` + new URLSearchParams({ where: JSON.stringify({ plan: "free" }), context: "edit" }), { as: "admin" });
  assert.deepEqual(listed.json.map((u: any) => u.id), [admin], "the read rule (`self`) still decides");
  const hidden = await http("GET", `${coreUsers}?` + new URLSearchParams({ where: JSON.stringify({ suspendedAt: null }) }), { as: "admin" });
  assert.deepEqual([hidden.status, hidden.json.code], [403, "forbidden"]);
});

test("core users meta writes never leave a transaction behind: late errors and throws roll back", () => {
  const sub = harness.users.subscriber.id;
  first("update", "members", JSON.stringify({ id: sub }), JSON.stringify({ points: 5 }));
  const out = JSON.parse(wp("eval", `
    $db = \\First\\Wp\\Plugin::instance()->db();
    $points = static fn () => (int) $db->findFirst('members', ['where' => ['id' => ${sub}]])['points'];
    $name = static fn () => (clean_user_cache(${sub}) || true) ? get_userdata(${sub})->display_name : '';
    $before = $name();
    wp_set_current_user(${sub});
    // A REST field that refuses after core and the member fields were written, inside an open transaction.
    add_action('rest_api_init', static fn () => register_rest_field('user', 'zfail', ['update_callback' => static fn () => new WP_Error('nope', 'refused late', ['status' => 400]), 'schema' => ['type' => 'string']]));
    $late = new WP_REST_Request('POST', '/wp/v2/users/me');
    $late->set_body_params(['name' => 'Half done', 'zfail' => 'x', 'meta' => ['points' => 6]]);
    try { $db->transaction(static fn () => rest_do_request($late)); $caught = null; } catch (Throwable $e) { $caught = $e->getMessage(); }
    $afterLate = [$caught, $points(), $name() === $before];
    // A hook that throws during core's save: the caller catches it; nothing commits, nothing stays open.
    $throw = static function () { throw new RuntimeException('hook threw'); };
    add_action('profile_update', $throw);
    $thrown = new WP_REST_Request('POST', '/wp/v2/users/me');
    $thrown->set_body_params(['name' => 'Thrown', 'meta' => ['points' => 7]]);
    try { rest_do_request($thrown); $caught = null; } catch (Throwable $e) { $caught = $e->getMessage(); }
    remove_action('profile_update', $throw);
    $afterThrow = [$caught, $points(), $name() === $before, \\First\\Wp\\Plugin::instance()->connection()->inTransaction()];
    // The next member write opens and commits normally.
    $next = new WP_REST_Request('POST', '/wp/v2/users/me');
    $next->set_body_params(['meta' => ['points' => 8]]);
    $status = rest_do_request($next)->get_status();
    echo wp_json_encode([$afterLate, $afterThrow, [$status, $points()]]);
  `));
  assert.deepEqual(out, [["refused late", 5, true], ["hook threw", 5, true, false], [200, 8]]);
});

test("core users updates through First keep core's role check and password path", () => {
  const sub = harness.users.subscriber.id;
  const out = JSON.parse(wp("eval", `
    wp_set_current_user(1);
    // An admin can't demote themselves out of edit_users: core's own check runs before First's update.
    $demote = new WP_REST_Request('POST', '/wp/v2/users/me');
    $demote->set_body_params(['roles' => ['subscriber']]);
    $demoted = rest_do_request($demote);
    // A password change stays core's (cookie re-issue, notice): the hash changes; member fields go to First.
    $before = get_userdata(${sub})->user_pass;
    $pass = new WP_REST_Request('POST', '/wp/v2/users/${sub}');
    $pass->set_body_params(['password' => 'another long password 2', 'meta' => ['points' => 4]]);
    $changed = rest_do_request($pass);
    clean_user_cache(${sub});
    $refused = get_userdata(${sub})->user_pass !== $before;
    // The member themself: the update rule covers their row, so both the password and the field save.
    wp_set_current_user(${sub});
    $own = new WP_REST_Request('POST', '/wp/v2/users/me');
    $own->set_body_params(['password' => 'another long password 2', 'meta' => ['points' => 4]]);
    $saved = rest_do_request($own);
    clean_user_cache(${sub});
    $ok = wp_check_password('another long password 2', get_userdata(${sub})->user_pass, ${sub});
    wp_set_password('first-test-subscriber', ${sub});
    wp_set_current_user(1);
    echo wp_json_encode([$demoted->get_status(), $demoted->get_data()['code'] ?? null, array_values(wp_get_current_user()->roles), $changed->get_status(), $refused, $saved->get_status(), $ok, $saved->get_data()['meta']['points'] ?? null]);
  `));
  assert.deepEqual(out, [403, "rest_user_invalid_role", ["administrator"], 404, false, 200, true, 4]);
});
