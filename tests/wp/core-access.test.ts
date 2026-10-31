// Core /wp/v2/zero_* under Zero's access rules (lane R): the block editor keeps its REST routes, but
// they answer exactly what /zero/v1 would. Fixtures: tests/wp/app/lanes/rest.ts (vault: admin-only;
// ledger: owners read and edit their own rows; payroll: anyone reads, salary admin-only).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { core, harness, http, ok, run, wp, zero } from "./env.ts";

let vaultId: number;
let mine: number;
let theirs: number;
let payId: number;
const author = harness.users.author.id;

before(() => {
  vaultId = zero("insert", "vault", JSON.stringify({ title: `Vault ${run}`, code: "1234" }))[0].id;
  [mine, theirs] = zero("insert", "ledger", JSON.stringify([{ title: `Mine ${run}`, ownerId: author }, { title: `Theirs ${run}`, ownerId: author + 1000 }])).map((r: any) => r.id);
  payId = zero("insert", "payroll", JSON.stringify({ title: `Pay ${run}`, salary: "90k" }))[0].id;
});

const ids = (r: { json: any }) => r.json.map((p: any) => p.id).sort((a: number, b: number) => a - b);

test("reads answer the read rule: denied, filtered, or whole", async () => {
  const anonList = await http("GET", `${core}/zero_vault`);
  assert.deepEqual([anonList.status, anonList.json.code], [401, "unauthenticated"], "an admin-only collection is refused, not listed");
  assert.equal((await http("GET", `${core}/zero_vault/${vaultId}`)).status, 401);
  assert.equal((await http("GET", `${core}/zero_vault/${vaultId}`, { as: "editor" })).status, 403);
  const admin = await http("GET", `${core}/zero_vault/${vaultId}`, { as: "admin" });
  assert.deepEqual([admin.status, admin.json.acf.zero_code], [200, "1234"]);

  // A filtering rule: the author's list holds her row only, and the other row is 404 as on /zero/v1.
  const listed = await http("GET", `${core}/zero_ledger?per_page=100&search=${run}`, { as: "author" });
  assert.deepEqual([ids(listed), listed.type.startsWith("application/json")], [[mine], true]);
  assert.equal(Number((await fetch(`${core}/zero_ledger?search=${run}`, { headers: { Authorization: "Basic " + btoa(`author:${harness.users.author.appPassword}`) } })).headers.get("x-wp-total")), 1, "the total counts only her rows");
  assert.equal((await http("GET", `${core}/zero_ledger/${theirs}`, { as: "author" })).status, 404);
  assert.deepEqual(ids(await http("GET", `${core}/zero_ledger?per_page=100&search=${run}`, { as: "editor" })), [mine, theirs]);
});

test("every response drops the fields the viewer can't read", async () => {
  const anon = await http("GET", `${core}/zero_payroll/${payId}`);
  assert.equal(anon.status, 200);
  assert.deepEqual(Object.keys(anon.json.acf).filter((k) => k.startsWith("zero_salary")), [], "salary and its _source are gone");
  assert.equal(anon.json.title.rendered, `Pay ${run}`);
  const listed = (await http("GET", `${core}/zero_payroll?search=${run}`, { as: "editor" })).json[0];
  assert.equal("zero_salary" in listed.acf, false, "lists and the edit context too");
  assert.equal((await http("GET", `${core}/zero_payroll/${payId}?context=edit`, { as: "editor" })).json.acf.zero_salary, undefined);
  assert.equal((await http("GET", `${core}/zero_payroll/${payId}`, { as: "admin" })).json.acf.zero_salary, "90k");
});

test("writes need Zero's create/update rules, not role capabilities", async () => {
  const count = () => Number(wp("post", "list", "--post_type=zero_vault", "--post_status=any", "--format=count"));
  const before = count();
  const authorCreate = await http("POST", `${core}/zero_vault`, { as: "author", body: { title: "x", status: "publish" } });
  assert.equal(authorCreate.status, 403, JSON.stringify(authorCreate.json));
  assert.equal((await http("POST", `${core}/zero_vault/${vaultId}`, { as: "editor", body: { title: "y" } })).status, 403);
  assert.equal((await http("DELETE", `${core}/zero_vault/${vaultId}`, { as: "editor" })).status, 403);
  assert.equal(count(), before, "nothing was created");
  const adminCreate = await http("POST", `${core}/zero_vault`, { as: "admin", body: { title: `Admin ${run}`, status: "publish" } });
  assert.equal(adminCreate.status, 201, JSON.stringify(adminCreate.json));

  // An owner-filtered update rule: her row yes, another's no; a subscriber may not create at all.
  const own = await http("POST", `${core}/zero_ledger/${mine}`, { as: "author", body: { title: `Mine ${run} edited` } });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.equal((await http("POST", `${core}/zero_ledger/${theirs}`, { as: "author", body: { title: "stolen" } })).status, 403);
  assert.equal((await http("POST", `${core}/zero_ledger`, { as: "subscriber", body: { title: "s", status: "publish" } })).status, 403);
  assert.equal((await ok("GET", `/ledger/${mine}`, { as: "editor" })).title, `Mine ${run} edited`);
});
