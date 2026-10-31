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
  const viaApp = await fetch(`${api}/me`, { headers: basic });
  assert.deepEqual([viaApp.status, (await viaApp.json()).code], [403, "suspended"]);
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

test("application passwords still authenticate /zero/v1 as before", async () => {
  const me = await fetch(`${api}/me`, { headers: auth("editor") });
  assert.equal((await me.json()).data.role, "editor");
});
