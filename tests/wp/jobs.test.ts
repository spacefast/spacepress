// Feature 3 on real WordPress (§6.1): a hook's enqueue and its Action Scheduler action commit together,
// Action Scheduler runs the compiled handler, failures retry with backoff until dead, and once()
// plus Idempotency-Key replay instead of re-running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { api, auth, harness, http, ok, problem, run, sql, wp, first } from "./env.ts";

const jobRow = (id: string) => sql(`SELECT state, attempts, runAt, lastError FROM wp_tp__jobs WHERE id = '${id}'`)[0];
const actions = (id: string) =>
  sql(`SELECT a.status FROM wp_actionscheduler_actions a WHERE a.hook = 'tp_job' AND a.args = '{"id":"${id}"}' ORDER BY a.action_id`).map((r) => r.status);
const jobFor = (noteId: number) =>
  sql(`SELECT id FROM wp_tp__jobs WHERE job = 'stamp' AND JSON_VALUE(input, '$.noteId') = ${noteId}`).map((r) => r.id);
/** Run every due tp_job action through Action Scheduler's WP-CLI queue runner, as cron would. */
const runQueue = () => wp("action-scheduler", "run", "--hooks=tp_job");
/** Run one pending action now, through Action Scheduler's own runner, without waiting for its date. */
const runPending = (id: string) => {
  const [action] = sql(`SELECT action_id FROM wp_actionscheduler_actions WHERE hook = 'tp_job' AND status = 'pending' AND args = '{"id":"${id}"}'`);
  wp("action-scheduler", "action", "run", action.action_id);
};

test("a hook's enqueue becomes an Action Scheduler action, and AS runs the handler", async () => {
  const note = await ok("POST", "/job_notes", { as: "editor", body: { title: `stamp ${run}` } });
  const [id] = jobFor(note.id);
  assert.ok(id, "the hook enqueued a job");
  assert.equal(jobRow(id).state, "pending");
  assert.deepEqual(actions(id), ["pending"], "one pending AS action carries the job id");

  runQueue();
  assert.deepEqual({ state: jobRow(id).state, attempts: jobRow(id).attempts }, { state: "done", attempts: "1" });
  assert.deepEqual(actions(id), ["complete"]);
  const [stamped] = await ok("GET", `/job_notes?where=${encodeURIComponent(JSON.stringify({ id: note.id }))}`, { as: "editor" });
  assert.equal(stamped.stamped, `${id}:1`, "the handler's write is visible through the API");
});

test("an action's nested JSON reaches the queued handler byte for byte", async () => {
  const note = await ok("POST", "/job_notes", { as: "editor", body: { title: `json ${run}` } });
  const queued = await ok("POST", "/actions/refsEnqueue", { as: "editor", body: { noteId: note.id, meta: { "1": 1, "0": 2, empty: {} } } });
  runPending(queued.id);
  const [stored] = await ok("GET", `/job_notes?where=${encodeURIComponent(JSON.stringify({ id: note.id }))}`, { as: "editor" });
  assert.equal(stored.stamped, queued.sent);
  assert.equal(queued.sent, '{"0":2,"1":1,"empty":{}}');
});

test("a rolled-back request leaves no job or AS action", async () => {
  const before = sql("SELECT COUNT(*) AS n FROM wp_actionscheduler_actions WHERE hook = 'tp_job'")[0].n;
  await problem("POST", "/job_notes", { as: "editor", body: { title: "Explode" } }, { status: 500, code: "boom", pointer: undefined });
  assert.deepEqual(sql("SELECT id FROM wp_tp_job_notes WHERE title = 'Explode'"), []);
  assert.deepEqual(sql("SELECT id FROM wp_tp__jobs WHERE JSON_VALUE(input, '$.noteId') NOT IN (SELECT id FROM wp_tp_job_notes)"), []);
  assert.equal(sql("SELECT COUNT(*) AS n FROM wp_actionscheduler_actions WHERE hook = 'tp_job'")[0].n, before);
});

// The same cases tests/php/jobs_test.php runs on SQLite (tests/php/jobs_transaction_cases.php), here on MariaDB:
// rollback, commit, a rolled-back group creation under a persistent-style object cache, a crash after commit.
test("on MariaDB, a job and its Action Scheduler action commit or roll back together", () => {
  const cases = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../php/jobs_transaction_cases.php"), "utf8").replace(/^<\?php\s*declare\(strict_types=1\);/, "");
  const results: [string, unknown, unknown][] = JSON.parse(wp("eval", `${cases}\necho wp_json_encode(firstJobsTransactionCases('stamp', ['noteId' => 0]));`));
  assert.equal(results.length, 5);
  for (const [label, actual, expected] of results) assert.deepEqual(actual, expected, label);
});

test("a failing job is retried through Action Scheduler with backoff, then dead after `retries`", async () => {
  const note = await ok("POST", "/job_notes", { as: "editor", body: { title: `fail ${run}`, fail: true } });
  const [id] = jobFor(note.id);
  runQueue();
  const initial = jobRow(id);
  assert.deepEqual({ state: initial.state, attempts: initial.attempts }, { state: "failed", attempts: "1" });
  assert.match(initial.lastError, /stamp failed on attempt 1/);
  // AS saw a completed action; TypedPress re-scheduled the retry one minute out.
  assert.deepEqual(actions(id), ["complete", "pending"]);
  const due = sql(`SELECT scheduled_date_gmt AS at FROM wp_actionscheduler_actions WHERE hook = 'tp_job' AND status = 'pending' AND args = '{"id":"${id}"}'`)[0].at;
  assert.equal(Date.parse(due + "Z"), Date.parse(initial.runAt.replace(/\.\d+Z$/, "Z")), "AS fires at the job's backoff runAt");
  assert.ok(Date.parse(initial.runAt) - Date.now() > 50_000, "first backoff is about a minute");

  runQueue();
  assert.deepEqual(actions(id), ["complete", "pending"], "the queue runner leaves the retry until its backoff is due");
  runPending(id);
  const dead = jobRow(id);
  assert.deepEqual({ state: dead.state, attempts: dead.attempts }, { state: "dead", attempts: "2" });
  assert.match(dead.lastError, /stamp failed on attempt 2/);
  assert.deepEqual(actions(id), ["complete", "complete"], "a dead job schedules nothing more");
  assert.deepEqual(sql(`SELECT stamped FROM wp_tp_job_notes WHERE id = ${note.id}`), [{ stamped: "NULL" }], "each failed attempt's write rolled back");
  assert.deepEqual(first("jobs", "list", "--state=dead").map((j: { id: string }) => j.id).filter((j: string) => j === id), [id]);
});

/**
 * `wp eval` in its own process, inside one TypedPress transaction. With `hold`, it prints "ready" after
 * `body` and keeps the transaction open until the test writes to its stdin. Every wait has a deadline.
 */
function evalProcess(body: string, hold: boolean) {
  const child = spawn(join(dirname(fileURLToPath(import.meta.url)), "harness.sh"), ["wp", "eval", `
    $db = \\TypedPress\\Wp\\Runtime::plugin()->app()->db;
    echo json_encode($db->transaction(static function () {
      $out = (static function () { ${body} })();
      if (${hold}) { fwrite(STDOUT, "ready\\n"); fflush(STDOUT); fgets(STDIN); }
      return $out;
    })), "\\n";`], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (err += c));
  let code: number | null = null;
  const exited = new Promise<number>((resolve) => child.on("close", (c) => resolve((code = c ?? 1))));
  const lines = () => out.split("\n").filter(Boolean);
  const until = async (what: string, ok: () => boolean) => {
    const deadline = Date.now() + 30_000;
    while (!ok()) {
      if (code !== null && !ok()) throw new Error(`process exited before ${what}: ${err.slice(-500)}`);
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setImmediate(r));
    }
  };
  return {
    ready: () => until("ready", () => lines()[0] === "ready"),
    release: () => child.stdin.end("go\n"),
    result: async () => {
      await until("exit", () => code !== null);
      assert.equal(code, 0, err.slice(-1000));
      return JSON.parse(lines().at(-1)!);
    },
    kill: () => child.kill(),
    until,
  };
}

/** One MariaDB count with a hard timeout, so a stuck database fails the test instead of hanging it. */
function boundedCount(query: string): number {
  const out = execFileSync(join(dirname(fileURLToPath(import.meta.url)), "harness.sh"), ["sql", query], { encoding: "utf8", timeout: 10_000 });
  return Number(out.trim().split("\n")[1]);
}

/** A holds its transaction after `body`; B runs `body` too; A is released only once B's statement is blocked on A. */
async function contend(body: string, blockedSql: string) {
  const a = evalProcess(body, true);
  let b: ReturnType<typeof evalProcess> | undefined;
  try {
    await a.ready();
    // B starts only after A holds its claim, so B's first claim must wait on A's row lock.
    b = evalProcess(body, false);
    const blocked = () => boundedCount(`SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE INFO LIKE '${blockedSql}%'`) > 0;
    await b.until("B to block on A's lock", blocked);
    a.release();
    return [await a.result(), await b.result()];
  } finally {
    a.kill();
    b?.kill();
  }
}

test("an agents: true job is the blog/job-stamp ability: editors enqueue it, AS runs it, subscribers are refused", async () => {
  const note = await ok("POST", "/job_notes", { as: "editor", body: { title: `ability ${run}` } });
  runQueue(); // the hook's own job
  const run1 = (who: "editor" | "subscriber") =>
    http("POST", `${harness.url}/wp-json/wp-abilities/v1/abilities/blog/job-stamp/run`, { as: who, body: { input: { noteId: note.id } } });
  const denied = await run1("subscriber");
  assert.equal(denied.status, 403, JSON.stringify(denied.json));
  const r = await run1("editor");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(actions(r.json.id), ["pending"], "the ability's enqueue reached Action Scheduler after commit");
  runQueue();
  assert.equal(jobRow(r.json.id).state, "done");
  assert.deepEqual(sql(`SELECT stamped FROM wp_tp_job_notes WHERE id = ${note.id}`), [{ stamped: `${r.json.id}:1` }]);
});

test("concurrent same-key enqueues on MariaDB agree on one job", async () => {
  const key = `race-${run}`;
  const ids = await contend(`return \\TypedPress\\Jobs\\Jobs::enqueue('stamp', ['noteId' => 0], ['key' => '${key}'])['id'];`, "INSERT IGNORE INTO `wp_tp__jobs`");
  assert.equal(ids[0], ids[1], "the waiting caller got the winner's job id");
  assert.deepEqual(sql(`SELECT id FROM wp_tp__jobs WHERE job = 'stamp' AND \`key\` = '${key}'`).map((r) => r.id), [ids[0]], "and that job exists, alone");
  wp("eval", `\\TypedPress\\Wp\\Runtime::plugin()->app()->db->transaction(fn () => \\TypedPress\\Jobs\\Storage::run('UPDATE {jobs} SET "state" = \\'dead\\', "dedupe" = NULL WHERE "key" = ?', ['${key}']));`);
});

test("job keys compare byte for byte on MariaDB", () => {
  const ids = JSON.parse(wp("eval", `echo json_encode(\\TypedPress\\Wp\\Runtime::plugin()->app()->db->transaction(fn () => [
    \\TypedPress\\Jobs\\Jobs::enqueue('stamp', ['noteId' => 0], ['key' => 'pad-${run}'])['id'],
    \\TypedPress\\Jobs\\Jobs::enqueue('stamp', ['noteId' => 0], ['key' => 'pad-${run} '])['id'],
    \\TypedPress\\Jobs\\Receipts::once('fn', 'pad-${run}', fn () => 'plain'),
    \\TypedPress\\Jobs\\Receipts::once('fn', 'pad-${run} ', fn () => 'padded'),
  ]));`));
  assert.notEqual(ids[0], ids[1], "a trailing space is a different job key");
  assert.deepEqual(ids.slice(2), ["plain", "padded"], "and a different once() key");
  wp("eval", `\\TypedPress\\Wp\\Runtime::plugin()->app()->db->transaction(fn () => \\TypedPress\\Jobs\\Storage::run('UPDATE {jobs} SET "state" = \\'dead\\', "dedupe" = NULL WHERE "key" LIKE ?', ['pad-${run}%']));`);
});

test("concurrent first uses of one once() key on MariaDB: one runs, the other gets a definite answer", async () => {
  const key = `once-race-${run}`;
  const [a, b] = await contend(`try { return \\TypedPress\\Jobs\\Receipts::once('fn', '${key}', fn () => 'ran'); } catch (\\TypedPress\\HttpError $e) { return $e->errorCode; }`, "INSERT IGNORE INTO `wp_tp__receipts`");
  // A ran and committed while B waited; B then sees A's finished receipt and replays it.
  assert.deepEqual([a, b], ["ran", "ran"]);
  assert.deepEqual(sql(`SELECT state FROM wp_tp__receipts WHERE \`key\` = '${key}'`), [{ state: "done" }]);
});

test("once() and Idempotency-Key replay instead of running again", async () => {
  const call = async (key?: string) => {
    const headers: Record<string, string> = { ...auth("editor"), "content-type": "application/json" };
    if (key) headers["idempotency-key"] = key;
    const res = await fetch(`${api}/actions/jobsOnce`, { method: "POST", headers, body: JSON.stringify({ note: run }) });
    return { status: res.status, replayed: res.headers.get("idempotent-replayed"), json: await res.json() };
  };
  const first = await call();
  const second = await call();
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.deepEqual(second.json, first.json, "once() returned the stored result");
  assert.equal(sql(`SELECT COUNT(*) AS n FROM wp_tp_job_notes WHERE title = 'once ${run}'`)[0].n, "1");

  const keyed = await call(`k-${run}`);
  const replay = await call(`k-${run}`);
  assert.deepEqual([keyed.replayed, replay.replayed, replay.json], [null, "true", keyed.json]);
  const res = await fetch(`${api}/actions/jobsOnce`, {
    method: "POST",
    headers: { ...auth("editor"), "content-type": "application/json", "idempotency-key": `k-${run}` },
    body: JSON.stringify({ note: `${run}-other` }),
  });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "idempotency_mismatch");
});

test("an Idempotency-Key belongs to the run it was sent with, not to abilities that run calls", async () => {
  const twice = await fetch(`${api}/actions/jobsTwice`, {
    method: "POST",
    headers: { ...auth("editor"), "content-type": "application/json", "idempotency-key": `outer-${run}` },
    body: JSON.stringify({ note: `twice-${run}` }),
  });
  const body = await twice.json();
  // Before, both inner runs inherited the outer key: the second failed with 409 idempotency_mismatch.
  assert.equal(twice.status, 200, JSON.stringify(body));
  assert.equal(sql(`SELECT COUNT(*) AS n FROM wp_tp_job_notes WHERE title IN ('once twice-${run}-a', 'once twice-${run}-b')`)[0].n, "2", "both inner runs ran");
});

// ---- webhooks (D2): a local receiver the WordPress container reaches through host.docker.internal.

test("a committed write reaches a local receiver through Action Scheduler, signed, retried after a 500", async (t) => {
  // The receiver is its own process: WP-CLI calls below block this one's event loop.
  const dir = mkdtempSync(join(tmpdir(), "typedpress-hook-"));
  const statusFile = join(dir, "status");
  const log = join(dir, "log");
  writeFileSync(statusFile, "500"); // the first delivery fails, so the retry path runs through Action Scheduler too
  const receiver = spawn(process.execPath, ["-e", `
    const fs = require("node:fs");
    const server = require("node:http").createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ headers: req.headers, body }) + "\\n");
        res.writeHead(Number(fs.readFileSync(${JSON.stringify(statusFile)}, "utf8"))).end("ok");
      });
    });
    server.listen(0, "0.0.0.0", () => console.log(server.address().port));
  `], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => { receiver.kill(); rmSync(dir, { recursive: true, force: true }); });
  const line = await Promise.race([
    once(receiver.stdout!, "data").then(([chunk]) => chunk),
    once(receiver, "exit").then(() => { throw new Error("the webhook receiver exited before announcing its port"); }),
    once(receiver, "error").then(([e]) => { throw e; }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("the webhook receiver did not start within 10s")), 10_000).unref()),
  ]);
  const port = Number(String(line).trim());
  const deliveries = (): { headers: Record<string, string>; body: string }[] =>
    existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const secret = `whsec_${run}`;
  const constants: [string, string][] = [["TP_WP_HOOK_URL", `http://host.docker.internal:${port}/hook`], ["TP_WP_HOOK_SECRET", secret]];
  for (const [name, value] of constants) wp("config", "set", name, value, "--type=constant");
  t.after(() => { for (const [name] of constants) wp("config", "delete", name, "--type=constant"); });

  const note = await ok("POST", "/hook_notes", { as: "editor", body: { title: `hook ${run}` } });
  const [job] = sql(`SELECT id, state FROM wp_tp__jobs WHERE job = 'typedpress.webhook' AND JSON_VALUE(input, '$.id') = ${note.id}`);
  assert.equal(job.state, "pending");
  assert.deepEqual(actions(job.id), ["pending"]);

  runQueue();
  const mine = () => deliveries().filter((d) => d.headers["typedpress-event-id"] === job.id);
  assert.equal(mine().length, 1, "the first attempt reached the receiver");
  assert.deepEqual([jobRow(job.id).state, jobRow(job.id).attempts], ["failed", "1"]);
  assert.match(jobRow(job.id).lastError, /answered 500/);
  writeFileSync(statusFile, "200");
  runPending(job.id);
  assert.deepEqual([jobRow(job.id).state, jobRow(job.id).attempts], ["done", "2"]);

  assert.equal(mine().length, 2, "the retry delivered again with the same event id");
  const last = mine()[1];
  const event = JSON.parse(last.body);
  assert.deepEqual({ ...event, at: undefined }, { id: job.id, event: "hook_notes.created", collection: "hook_notes", at: undefined, data: { row: note } });
  assert.equal(last.headers["typedpress-event-id"], job.id);
  assert.equal(last.headers["typedpress-event"], "hook_notes.created");
  const [, ts, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(last.headers["typedpress-signature"]))!;
  assert.equal(v1, createHmac("sha256", secret).update(`${ts}.${last.body}`).digest("hex"), "the receiver can verify the signature");
  assert.ok(Math.abs(Date.now() / 1000 - Number(ts)) < 120);
});

test("an inbound action with signature runs for a valid first signature and rejects a forged one, with no credentials", async (t) => {
  const inbound = `in_${run}`;
  wp("config", "set", "TP_WP_INBOUND_SECRET", inbound, "--type=constant");
  t.after(() => wp("config", "delete", "TP_WP_INBOUND_SECRET", "--type=constant"));
  const body = JSON.stringify({ title: run });
  const send = (sig: string) => fetch(`${api}/actions/jobsInbound`, { method: "POST", headers: { "content-type": "application/json", "typedpress-signature": sig }, body });
  const sign = (at: number, key = inbound) => `t=${at},v1=${createHmac("sha256", key).update(`${at}.${body}`).digest("hex")}`;
  const now = Math.floor(Date.now() / 1000);
  const accepted = await send(sign(now));
  assert.deepEqual([accepted.status, await accepted.json()], [200, { data: { user: null } }]);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM wp_tp_job_notes WHERE title = 'inbound ${run}'`)[0].n, "1");
  // The stale/missing/rotated matrix lives in tests/php/webhooks_test.php; WordPress proves the transport.
  const forged = await send(sign(now, "forged"));
  assert.deepEqual([forged.status, (await forged.json()).code], [401, "invalid_signature"]);
});
