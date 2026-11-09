import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { api, harness, wp } from "../env.ts";

async function signIn(): Promise<string> {
  const site = harness.url;
  const clientId = "app_migration_acceptance";
  const redirect = `${site}/migration-callback`;
  wp("zero", "identity", "app", "add", "--name=Migration acceptance", `--redirect=${redirect}`, `--origin=${site}`, `--id=${clientId}`);
  const login = await fetch(`${site}/wp-json/first-identity/v1/sign-in/password`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: site },
    body: JSON.stringify({ login: "subscriber", password: "first-test-subscriber" }),
  });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { data: { kind: "signed_in" } });
  const cookie = login.headers.getSetCookie().find(value => value.startsWith("zi_session="))?.split(";")[0];
  assert.ok(cookie, "password sign-in issues a session");
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect,
    scope: "openid email profile", state: randomBytes(24).toString("base64url"), nonce: randomBytes(24).toString("base64url"),
    code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const page = await fetch(`${site}/identity/authorize?${params}`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(page.status, 200);
  const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(await page.text())?.[1];
  assert.ok(csrf, "consent page supplies its CSRF token");
  const consent = await fetch(`${site}/identity/authorize`, { method: "POST", redirect: "manual",
    headers: { Cookie: cookie, Origin: site, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...Object.fromEntries(params), csrf }) });
  assert.equal(consent.status, 302);
  const location = consent.headers.get("location");
  assert.ok(location, "consent returns a callback");
  const callback = new URL(location);
  assert.equal(callback.origin + callback.pathname, redirect);
  assert.equal(callback.searchParams.get("state"), params.get("state"));
  const code = callback.searchParams.get("code");
  assert.ok(code, "consent returns an authorization code");
  const exchange = await fetch(`${site}/identity/token`, { method: "POST", headers: { Origin: site },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: redirect, code, code_verifier: verifier }) });
  assert.equal(exchange.status, 200);
  const tokens: unknown = await exchange.json();
  assert.ok(typeof tokens === "object" && tokens !== null && "access_token" in tokens && typeof tokens.access_token === "string");
  return tokens.access_token;
}

test("migrated requireSignIn uses native identity and keeps auth flags", async () => {
  const invoke = (headers: Record<string, string> = {}) => fetch(`${api}/actions/profile`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}",
  });
  assert.equal((await invoke()).status, 401);
  const signedIn = await invoke({ Authorization: `Bearer ${await signIn()}` });
  assert.equal(signedIn.status, 200);
  const result: unknown = await signedIn.json();
  assert.deepEqual(result, { data: { signedIn: true, guest: false, name: "Subscriber" } });
  const guest = await fetch(`${api}/auth/guest`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(guest.status, 201);
  const issued: unknown = await guest.json();
  assert.ok(typeof issued === "object" && issued !== null && "data" in issued);
  const tokens = issued.data;
  assert.ok(typeof tokens === "object" && tokens !== null && "accessToken" in tokens);
  assert.equal(typeof tokens.accessToken, "string");
  assert.equal((await invoke({ Authorization: `Bearer ${tokens.accessToken}` })).status, 401);
});
