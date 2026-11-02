// Field-level access over /wp-json/zero/v1 on real WordPress (phase 2 §4.3), with the lane B
// fixtures in tests/wp/app/lanes/fields.ts: post-backed (SCF meta) and table rows are stripped,
// including `with` rows, for anonymous, an owning author, an editor and an admin; refusals and
// group merges reach postmeta. The policy matrix lives in tests/php/db_test.php.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "./app/zero/client/index.ts";
import { api, auth, harness, ok, problem, qs, run, zero } from "./env.ts";

let team: { id: number };
let mine: { id: number };
let theirs: { id: number };
const owner = harness.users.author.id;

before(() => {
  team = zero("insert", "field_teams", JSON.stringify({ name: `Core ${run}`, budget: 1000 }))[0];
  [mine, theirs] = zero("insert", "field_staff", JSON.stringify([
    { name: `Owned ${run}`, email: "owned@example.test", ownerId: owner, salary: 10, notes: { public: "hi", private: "secret" }, teamId: team.id },
    { name: `Other ${run}`, email: "other@example.test", ownerId: owner + 1000, salary: 20, teamId: team.id },
  ]));
});

const where = (w: unknown) => qs({ where: w });

test("reads remove the columns a viewer may not read, per row and in with rows", async () => {
  const anonymous = await ok("GET", `/field_staff/${mine.id}`);
  assert.deepEqual(
    { keys: Object.keys(anonymous).filter((k) => ["email", "salary", "notes"].includes(k)), notes: anonymous.notes },
    { keys: ["notes"], notes: { public: "hi" } },
    "anonymous: email, salary and the private sub-field are absent, not null",
  );
  const author = await ok("GET", `/field_staff${where({ teamId: team.id })}&orderBy=id`, { as: "author" });
  assert.deepEqual(author.map((r: any) => [r.salary ?? "hidden", "email" in r]), [[10, false], ["hidden", false]], "the owner sees only her own salary");
  const editor = await ok("GET", `/field_staff/${theirs.id}`, { as: "editor" });
  assert.deepEqual([editor.email, editor.salary], ["other@example.test", 20]);

  const editorClient = createClient({ url: api, headers: auth("editor") });
  const withTeam = await editorClient.fieldStaff.get(mine.id, { with: { team: true } });
  assert.deepEqual([withTeam.team?.name, "budget" in (withTeam.team ?? {})], [`Core ${run}`, false], "a with-loaded parent is stripped");
  const withMembers = await createClient({ url: api }).fieldTeams.get(team.id, { with: { members: true } });
  assert.deepEqual(withMembers.members.map((m) => ["email" in m, "salary" in m]), [[false, false], [false, false]], "with-loaded children are stripped");
  assert.equal((await ok("GET", `/field_staff/${mine.id}?with=team`, { as: "admin" })).team.budget, 1000);
  assert.equal(zero("find", "field_staff", JSON.stringify({ where: { id: mine.id } }))[0].notes.private, "secret", "trusted reads see everything");
});

// The selector policy itself is held in tests/php/db_test.php; here one postmeta-backed filter and one
// relation filter across post↔table prove the WordPress path reaches it.
test("filters on a hidden column are refused over /zero/v1", async () => {
  const forbidden = (pointer: string) => ({ status: 403, code: "forbidden", pointer });
  await problem("GET", `/field_staff${where({ email: { like: "o%" } })}`, {}, forbidden("/where/email"));
  await problem("GET", `/field_staff${where({ team: { budget: { gt: 500 } } })}`, { as: "editor" }, forbidden("/where/team/budget"));
});

test("a write to a column the viewer can't set is refused and saves nothing", async () => {
  await problem("PATCH", `/field_staff/${mine.id}`, { as: "author", body: { salary: 99 } }, { status: 403, code: "forbidden", pointer: "/salary" });
  await problem("PATCH", `/field_staff/${mine.id}`, { as: "editor", body: { salary: 99 } }, { status: 403, code: "forbidden", pointer: "/salary" });
  assert.equal(zero("find", "field_staff", JSON.stringify({ where: { id: mine.id } }))[0].salary, 10);
  assert.equal((await ok("PATCH", `/field_staff/${mine.id}`, { as: "admin", body: { salary: 11 } })).salary, 11);
});

test("a group update keeps the sub-field the viewer can't see in postmeta", async () => {
  const kept = await ok("PATCH", `/field_staff/${mine.id}`, { as: "author", body: { notes: { public: "edited" } } });
  assert.deepEqual([kept.notes, zero("find", "field_staff", JSON.stringify({ where: { id: mine.id } }))[0].notes], [{ public: "edited" }, { public: "edited", private: "secret" }]);
});

test("/_schema reports showIf on WordPress", async () => {
  const described = (await ok("GET", "/_schema")).collections.field_staff;
  assert.deepEqual(described.columns.notes.fields.private.showIf, { public: { isNotNull: true } });
});
