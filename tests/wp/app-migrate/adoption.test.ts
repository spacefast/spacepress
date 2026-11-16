import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { api, harness, sql, wp, wpTry } from "../env.ts";

type Row = {
  id: string; title: string; done: boolean; score: number; owner: string;
  createdAt: string; updatedAt: string; category: string; note?: string; parent?: string;
};
async function action(name: string, input: object = {}): Promise<unknown> {
  const response = await fetch(`${api}/actions/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const result: unknown = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.ok(typeof result === "object" && result !== null && "data" in result);
  return result.data;
}
function row(value: unknown): Row {
  assert.ok(typeof value === "object" && value !== null);
  assert.ok("id" in value && typeof value.id === "string");
  assert.ok("title" in value && typeof value.title === "string");
  assert.ok("done" in value && typeof value.done === "boolean");
  assert.ok("score" in value && typeof value.score === "number");
  assert.ok("owner" in value && typeof value.owner === "string");
  assert.ok("createdAt" in value && typeof value.createdAt === "string");
  assert.ok("updatedAt" in value && typeof value.updatedAt === "string");
  assert.ok("category" in value && typeof value.category === "string");
  assert.ok(!("note" in value) || typeof value.note === "string");
  assert.ok(!("parent" in value) || typeof value.parent === "string");
  // All Row properties are checked above; keep the actual response to catch extra or null fields.
  return value as Row;
}

test("adopts original rows and keeps legacy action results and mutation atomicity", async () => {
  const table = "sf_spc_migrate_test_tasks_3c47092ff0";
  const before: unknown = JSON.parse(readFileSync(process.env.TP_APP_ADOPTION_BEFORE ?? "", "utf8"));
  assert.ok(typeof before === "object" && before !== null && "rows" in before && "ddl" in before);
  const actual: unknown = JSON.parse(wp("eval", `global $wpdb; echo wp_json_encode($wpdb->get_results('SELECT * FROM ${table} ORDER BY id', ARRAY_A));`));
  assert.deepEqual(actual, before.rows);
  const ddl = wp("eval", `global $wpdb; echo $wpdb->get_row('SHOW CREATE TABLE ${table}', ARRAY_N)[1];`);
  assert.equal(ddl, before.ddl);

  const existing = row(await action("get", { id: "41" }));
  assert.deepEqual(existing, { id: "41", title: "Existing first", done: false, score: 2.5,
    owner: "legacy-user", category: "inbox", createdAt: "2026-03-01T00:00:00.123Z", updatedAt: "2026-03-01T00:00:00.123Z" });
  const list = await action("list");
  assert.ok(Array.isArray(list));
  assert.deepEqual(list.map(row).map(r => r.id), ["9007199254740900", "42", "41"]);
  assert.equal(row(list[1]).done, true);
  assert.equal(row(list[0]).category, "inbox");
  assert.equal(row(list[1]).parent, "41");
  const owned = await action("owned", { db: "legacy-user", from: "41" });
  assert.ok(Array.isArray(owned));
  assert.deepEqual(owned.map(row).map(r => r.id), ["41", "42"]);
  assert.deepEqual(await action("first"), existing);
  assert.equal(await action("count"), 3);
  assert.equal(await action("get", { id: "999" }), null);
  const doneIds = async (done: boolean) => {
    const result = await action("byDone", { done });
    assert.ok(Array.isArray(result));
    return result.map(row).map(r => r.id);
  };
  assert.deepEqual(await doneIds(true), ["42"]);
  assert.deepEqual(await doneIds(false), ["41", "9007199254740900"]);

  const inserted = row(await action("add", { input: { title: "  New task  " } }));
  assert.equal(inserted.id, "9007199254740901");
  assert.equal(inserted.title, "New task");
  assert.equal(inserted.done, false);
  assert.equal(inserted.score, 2);
  assert.equal(inserted.category, "inbox");
  assert.equal(inserted.createdAt, inserted.updatedAt);
  assert.ok(!("note" in inserted));
  assert.deepEqual(await action("get", { id: "9007199254740901" }), inserted);
  assert.equal(inserted.owner, "legacy-user");
  assert.deepEqual(await doneIds(false), ["41", "9007199254740900", "9007199254740901"]);
  assert.equal(row(await action("setDone", { id: "9007199254740901", done: true })).done, true);
  assert.deepEqual(await doneIds(true), ["42", "9007199254740901"]);
  assert.deepEqual(await doneIds(false), ["41", "9007199254740900"]);
  assert.equal(row(await action("setDone", { id: "9007199254740901", done: false })).done, false);
  assert.deepEqual(await doneIds(true), ["42"]);
  const patched = row(await action("update", { id: "42", note: null }));
  assert.equal(patched.category, "inbox");
  assert.ok(!("note" in patched));
  const touched = row(await action("touch", { id: "41" }));
  assert.notEqual(touched.updatedAt, existing.updatedAt);
  assert.equal(touched.createdAt, existing.createdAt);
  await action("update", { id: "41", note: "clear me" });
  const cleared = row(await action("clearNote", { id: "41" }));
  assert.ok(!("note" in cleared));
  assert.equal(await action("update", { id: "999", note: "missing" }), null);
  assert.equal(await action("remove", { id: "9007199254740901" }), true);
  assert.equal(await action("remove", { id: "9007199254740901" }), false);
  const rollback = await fetch(`${api}/actions/rollback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(rollback.status, 422);
  assert.equal(await action("count"), 3);
  // Every read, update, and delete above still targeted the original table.
  assert.deepEqual(sql(`SELECT id FROM ${table} ORDER BY id`), [{ id: "41" }, { id: "42" }, { id: "9007199254740900" }]);
  const schemaOption = `tp_${harness.plugin.slice("typedpress-app-".length)}_schema`;
  const schemaBefore = sql(`SELECT option_value FROM wp_options WHERE option_name = '${schemaOption}'`);
  const ledgerBefore = sql("SELECT app, id FROM wp_tp__migrations ORDER BY app, id");
  // Legacy prefix indexes exceed MyISAM's key limit; restore them after the engine probe.
  sql(`ALTER TABLE ${table} DROP INDEX by_owner, DROP INDEX by_done, ENGINE=MyISAM`);
  sql(`UPDATE wp_options SET option_value = 'pending-storage-upgrade' WHERE option_name = '${schemaOption}'`);
  try {
    const refused = await fetch(`${api}/actions/list`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const problem: unknown = await refused.json();
    assert.equal(refused.status, 503);
    assert.ok(typeof problem === "object" && problem !== null && "code" in problem);
    assert.equal(problem.code, "unavailable");
    const cli: unknown = JSON.parse(wpTry("first", "migrate"));
    assert.ok(typeof cli === "object" && cli !== null && "error" in cli);
    assert.ok(typeof cli.error === "object" && cli.error !== null && "status" in cli.error && "code" in cli.error);
    assert.equal(cli.error.status, 500);
    assert.equal(cli.error.code, "internal");
    assert.deepEqual(sql(`SELECT option_value FROM wp_options WHERE option_name = '${schemaOption}'`), [{ option_value: "pending-storage-upgrade" }]);
    assert.deepEqual(sql("SELECT app, id FROM wp_tp__migrations ORDER BY app, id"), ledgerBefore);
  } finally {
    sql(`ALTER TABLE ${table} ENGINE=InnoDB, ADD KEY by_owner (owner(191), createdAt(191), id), ADD KEY by_done (done(191), createdAt(191), id)`);
  }
  assert.equal(await action("count"), 3);
  assert.deepEqual(sql(`SELECT option_value FROM wp_options WHERE option_name = '${schemaOption}'`), schemaBefore);
  assert.equal(harness.wp.startsWith("7.2"), true);
});
