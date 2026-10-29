// Feature 3 on real WordPress (§6.1): a hook's enqueue reaches Action Scheduler only after commit,
// Action Scheduler runs the compiled handler, failures retry with backoff until dead, and once()
// plus Idempotency-Key replay instead of re-running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { api, auth, ok, problem, run, sql, wp, zero } from "./env.ts";

const jobRow = (id: string) => sql(`SELECT state, attempts, runAt, lastError FROM wp_zero__jobs WHERE id = '${id}'`)[0];
const actions = (id: string) =>
  sql(`SELECT a.status FROM wp_actionscheduler_actions a WHERE a.hook = 'zero_job' AND a.args = '{"id":"${id}"}' ORDER BY a.action_id`).map((r) => r.status);
const jobFor = (noteId: number) =>
  sql(`SELECT id FROM wp_zero__jobs WHERE job = 'stamp' AND JSON_VALUE(input, '$.noteId') = ${noteId}`).map((r) => r.id);
/** Run every due zero_job action through Action Scheduler's WP-CLI queue runner, as cron would. */
const runQueue = () => wp("action-scheduler", "run", "--hooks=zero_job");
/** Run one pending action now, through Action Scheduler's own runner, without waiting for its date. */
const runPending = (id: string) => {
  const [action] = sql(`SELECT action_id FROM wp_actionscheduler_actions WHERE hook = 'zero_job' AND status = 'pending' AND args = '{"id":"${id}"}'`);
  wp("action-scheduler", "action", "run", action.action_id);
};

test("a hook's enqueue becomes an Action Scheduler action, and AS runs the handler", async () => {
  const note = await ok("POST", "/jobNotes", { as: "editor", body: { title: `stamp ${run}` } });
  const [id] = jobFor(note.id);
  assert.ok(id, "the hook enqueued a job");
  assert.equal(jobRow(id).state, "pending");
  assert.deepEqual(actions(id), ["pending"], "one pending AS action carries the job id");
  assert.equal(sql("SELECT COUNT(*) AS n FROM wp_zero__outbox")[0].n, "0", "the outbox drained after commit");

  runQueue();
  assert.deepEqual({ state: jobRow(id).state, attempts: jobRow(id).attempts }, { state: "done", attempts: "1" });
  assert.deepEqual(actions(id), ["complete"]);
  const [stamped] = await ok("GET", `/jobNotes?where=${encodeURIComponent(JSON.stringify({ id: note.id }))}`, { as: "editor" });
  assert.equal(stamped.stamped, `${id}:1`, "the handler's write is visible through the API");
});

test("a rolled-back request leaves no job, outbox row or AS action", async () => {
  const before = sql("SELECT COUNT(*) AS n FROM wp_actionscheduler_actions WHERE hook = 'zero_job'")[0].n;
  await problem("POST", "/jobNotes", { as: "editor", body: { title: "Explode" } }, { status: 500, code: "boom", pointer: undefined });
  assert.deepEqual(sql("SELECT id FROM wp_zero_jobNotes WHERE title = 'Explode'"), []);
  assert.deepEqual(sql("SELECT id FROM wp_zero__outbox"), []);
  assert.deepEqual(sql("SELECT id FROM wp_zero__jobs WHERE JSON_VALUE(input, '$.noteId') NOT IN (SELECT id FROM wp_zero_jobNotes)"), []);
  assert.equal(sql("SELECT COUNT(*) AS n FROM wp_actionscheduler_actions WHERE hook = 'zero_job'")[0].n, before);
});

test("a failing job is retried through Action Scheduler with backoff, then dead after `retries`", async () => {
  const note = await ok("POST", "/jobNotes", { as: "editor", body: { title: `fail ${run}`, fail: true } });
  const [id] = jobFor(note.id);
  runQueue();
  const first = jobRow(id);
  assert.deepEqual({ state: first.state, attempts: first.attempts }, { state: "failed", attempts: "1" });
  assert.match(first.lastError, /stamp failed on attempt 1/);
  // AS saw a completed action; Zero re-scheduled the retry one minute out.
  assert.deepEqual(actions(id), ["complete", "pending"]);
  const due = sql(`SELECT scheduled_date_gmt AS at FROM wp_actionscheduler_actions WHERE hook = 'zero_job' AND status = 'pending' AND args = '{"id":"${id}"}'`)[0].at;
  assert.equal(Date.parse(due + "Z"), Date.parse(first.runAt.replace(/\.\d+Z$/, "Z")), "AS fires at the job's backoff runAt");
  assert.ok(Date.parse(first.runAt) - Date.now() > 50_000, "first backoff is about a minute");

  runQueue();
  assert.deepEqual(actions(id), ["complete", "pending"], "the queue runner leaves the retry until its backoff is due");
  runPending(id);
  const dead = jobRow(id);
  assert.deepEqual({ state: dead.state, attempts: dead.attempts }, { state: "dead", attempts: "2" });
  assert.match(dead.lastError, /stamp failed on attempt 2/);
  assert.deepEqual(actions(id), ["complete", "complete"], "a dead job schedules nothing more");
  assert.deepEqual(sql(`SELECT stamped FROM wp_zero_jobNotes WHERE id = ${note.id}`), [{ stamped: "NULL" }], "each failed attempt's write rolled back");
  assert.deepEqual(zero("jobs", "list", "--state=dead").map((j: { id: string }) => j.id).filter((j: string) => j === id), [id]);
});

test("concurrent same-key enqueues on MariaDB agree on one job", async () => {
  const key = `race-${run}`;
  // A enqueues and keeps its transaction open until the test writes to its stdin. B starts only after
  // A's row exists, so B's lookup misses it and B's insert must wait on A's key lock. The test releases
  // A only once MariaDB shows B's insert blocked: the contested ordering, by barrier rather than timing.
  const enqueue = (hold: boolean) => {
    const child = spawn(join(dirname(fileURLToPath(import.meta.url)), "harness.sh"), ["wp", "eval", `
      $db = \\Zero\\Wp\\Runtime::plugin()->app()->db;
      echo $db->transaction(static function () {
        $id = \\Zero\\Jobs\\Jobs::enqueue('stamp', ['noteId' => 0], ['key' => '${key}'])['id'];
        if (${hold ? "true" : "false"}) { fwrite(STDOUT, "enqueued\\n"); fflush(STDOUT); fgets(STDIN); }
        return $id;
      }), "\\n";`], { stdio: ["pipe", "pipe", "inherit"] });
    const lines: string[] = [];
    const waiters: (() => void)[] = [];
    child.stdout.on("data", (c) => { lines.push(...String(c).split("\n").filter(Boolean)); waiters.splice(0).forEach((w) => w()); });
    const line = (n: number) => new Promise<string>((resolve) => {
      const check = () => (lines.length > n ? resolve(lines[n]) : waiters.push(check));
      check();
    });
    const exited = new Promise<void>((resolve, reject) => child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`wp eval exited ${code}`)))));
    return { child, line, exited };
  };
  // B blocked on A's key = B's insert is still executing (same DB user, so PROCESSLIST shows it).
  const waiting = () => Number(sql("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE INFO LIKE 'INSERT IGNORE INTO `wp_zero__jobs`%'")[0].n);
  const a = enqueue(true);
  assert.equal(await a.line(0), "enqueued");
  const b = enqueue(false);
  while (waiting() === 0) await new Promise((r) => setImmediate(r)); // poll InnoDB until B blocks on A's key
  a.child.stdin!.end("go\n");
  await Promise.all([a.exited, b.exited]);
  const ids = [await a.line(1), await b.line(0)];
  assert.equal(ids[0], ids[1], "the waiting caller got the winner's job id");
  assert.deepEqual(sql(`SELECT id FROM wp_zero__jobs WHERE job = 'stamp' AND \`key\` = '${key}'`).map((r) => r.id), [ids[0]], "and that job exists, alone");
  wp("eval", `\\Zero\\Wp\\Runtime::plugin()->app()->db->transaction(fn () => \\Zero\\Jobs\\Storage::run('UPDATE {jobs} SET "state" = \\'dead\\', "dedupe" = NULL WHERE "key" = ?', ['${key}']));`);
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
  assert.equal(sql(`SELECT COUNT(*) AS n FROM wp_zero_jobNotes WHERE title = 'once ${run}'`)[0].n, "1");

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
