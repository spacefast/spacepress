import assert from "node:assert/strict";
import { test } from "node:test";
import { api, auth } from "../env.ts";

test("migrated requireSignIn uses native identity and keeps auth flags", async () => {
  const invoke = (headers: Record<string, string> = {}) => fetch(`${api}/actions/profile`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}",
  });
  assert.equal((await invoke()).status, 401);
  const signedIn = await invoke(auth("subscriber"));
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
