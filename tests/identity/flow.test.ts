// The browser-less sign-in a frontend performs, over real HTTP against the identity stack: email
// code through Mailpit, consent with the session cookie + CSRF, the PKCE token exchange, Bearer on
// the WordPress REST API, refresh rotation and reuse, CORS for the registered origin, suspension.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const site = process.env.IDENTITY_URL!;
const mail = process.env.IDENTITY_MAIL!;
const app = { id: "app_identity_flow", redirect: "http://127.0.0.1:18181/callback", origin: "http://127.0.0.1:18181" };
const here = dirname(fileURLToPath(import.meta.url));
const b64 = (b: Buffer) => b.toString("base64url");

function wp(...args: string[]): string {
  return execFileSync("docker", ["compose", "-p", process.env.IDENTITY_PROJECT!, "-f", join(here, "compose.yml"), "exec", "-T", "cli", "wp", ...args], { encoding: "utf8" }).trim();
}

/** Poll Mailpit for the newest code sent to `to` (no sleeps: each poll is a real request). */
async function codeFor(to: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const list = await (await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const id = list.messages?.[0]?.ID;
    if (id) {
      const message = await (await fetch(`${mail}/api/v1/message/${id}`)).json();
      const code = /Your code is (\d{6})/.exec(message.Text)?.[1];
      if (code) return code;
    }
  }
  throw new Error(`no code for ${to}`);
}

async function identity(op: string, body: unknown, cookie = ""): Promise<{ status: number; json: any; cookie: string }> {
  const res = await fetch(`${site}/wp-json/zero-identity/v1/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: site, cookie },
    body: JSON.stringify(body),
  });
  const set = res.headers.getSetCookie().find((c) => c.startsWith("zi_session="));
  return { status: res.status, json: await res.json(), cookie: set ? set.split(";")[0] : cookie };
}

/** Email-code sign-in: returns the identity session cookie. */
async function signIn(email: string): Promise<string> {
  const start = await identity("sign-in/email", { email });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const done = await identity("sign-in/verify", { challenge_id: start.json.data.challenge_id, code: await codeFor(email) });
  assert.deepEqual(done.json, { data: { kind: "signed_in" } });
  return done.cookie;
}

/** Authorization code + PKCE with only fetch: authorize page → consent POST → token. */
async function authorize(cookie: string) {
  const verifier = b64(randomBytes(48));
  const query = new URLSearchParams({
    response_type: "code", client_id: app.id, redirect_uri: app.redirect, scope: "openid email profile",
    state: b64(randomBytes(24)), nonce: b64(randomBytes(24)), code_challenge_method: "S256",
    code_challenge: b64(createHash("sha256").update(verifier).digest()),
  });
  const page = await fetch(`${site}/identity/authorize?${query}`, { headers: { cookie }, redirect: "manual" });
  assert.equal(page.status, 200);
  const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(await page.text())?.[1];
  assert.ok(csrf, "consent page carries the session CSRF token");
  const consent = await fetch(`${site}/identity/authorize`, {
    method: "POST", redirect: "manual",
    headers: { cookie, origin: site, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...Object.fromEntries(query), csrf }),
  });
  assert.equal(consent.status, 302);
  const back = new URL(consent.headers.get("location")!);
  assert.equal(back.origin + back.pathname, app.redirect);
  assert.equal(back.searchParams.get("state"), query.get("state"));
  return token({ grant_type: "authorization_code", client_id: app.id, redirect_uri: app.redirect, code: back.searchParams.get("code")!, code_verifier: verifier });
}

async function token(body: Record<string, string>) {
  const res = await fetch(`${site}/identity/token`, { method: "POST", headers: { origin: app.origin }, body: new URLSearchParams(body) });
  return { status: res.status, json: await res.json(), cors: res.headers.get("access-control-allow-origin") };
}

const me = (access: string) => fetch(`${site}/wp-json/wp/v2/users/me?context=edit`, { headers: { authorization: `Bearer ${access}` } });

test("PKCE sign-in, Bearer, refresh rotation, reuse and suspension over HTTP", async () => {
  const email = `flow-${Date.now().toString(36)}@example.test`;
  const cookie = await signIn(email);
  const tokens = await authorize(cookie);
  assert.equal(tokens.status, 200, JSON.stringify(tokens.json));
  assert.equal(tokens.cors, app.origin, "the token endpoint allows the registered origin");
  assert.equal(tokens.json.token_type, "Bearer");

  const user = await me(tokens.json.access_token);
  assert.equal(user.status, 200);
  const profile = await user.json();
  assert.equal(profile.email, email, "the Bearer token resolves to the signed-in WordPress user");

  const rotated = await token({ grant_type: "refresh_token", client_id: app.id, refresh_token: tokens.json.refresh_token });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.json.refresh_token, tokens.json.refresh_token);
  assert.equal((await me(rotated.json.access_token)).status, 200);
  const reuse = await token({ grant_type: "refresh_token", client_id: app.id, refresh_token: tokens.json.refresh_token });
  assert.deepEqual([reuse.status, reuse.json.error], [400, "invalid_grant"]);
  const revoked = await me(rotated.json.access_token);
  assert.deepEqual([revoked.status, (await revoked.json()).code], [401, "invalid_token"], "reuse revoked the family");

  const again = await authorize(await signIn(email));
  wp("zero-identity", "suspend", String(profile.id));
  const suspended = await me(again.json.access_token);
  assert.deepEqual([suspended.status, (await suspended.json()).code], [403, "suspended"]);
  wp("zero-identity", "restore", String(profile.id));
});

test("CORS: preflight for a registered origin only", async () => {
  const preflight = (origin: string) => fetch(`${site}/identity/token`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } });
  const allowed = await preflight(app.origin);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), app.origin);
  assert.equal((await preflight("https://evil.example")).headers.get("access-control-allow-origin"), null);
});

test("discovery advertises refresh tokens and S256 only", async () => {
  const discovery = await (await fetch(`${site}/identity/.well-known/openid-configuration`)).json();
  assert.deepEqual(discovery.grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]);
  assert.equal(discovery.issuer, `${site}/identity`);
});
