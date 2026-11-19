import assert from "node:assert/strict";
import { test } from "node:test";
import { api, wp } from "../env.ts";

async function call(name: string, input: object): Promise<{ status: number; body: { data?: unknown } }> {
  const response = await fetch(`${api}/actions/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}
const captured = (to: string): string | null => {
  const out = wp("eval", `$f = WP_CONTENT_DIR . '/typedpress-test-mail/' . sanitize_file_name(${JSON.stringify(to)}) . '.txt'; echo is_file($f) ? file_get_contents($f) : '__none__';`);
  return out === "__none__" ? null : out;
};
const runQueue = () => wp("action-scheduler", "run", "--hooks=tp_job");
const mailJobs = () => JSON.parse(wp("eval", `global $wpdb; echo wp_json_encode($wpdb->get_results("SELECT state, attempts FROM {$wpdb->prefix}tp__jobs WHERE job = 'typedpress.mail'", ARRAY_A));`)) as { state: string }[];

test("migrated ctx.email.send queues with the write, sends after commit, and never after a rollback", async () => {
  const rolled = await call("join", { email: "rolled@example.test", fail: true });
  // A thrown Error is v2's 422 rejected; the write and its queued mail roll back together.
  assert.equal(rolled.status, 422, JSON.stringify(rolled.body));
  assert.equal(mailJobs().length, 0, "a rolled-back mutation queued nothing");
  runQueue();
  assert.equal(captured("rolled@example.test"), null);

  const joined = await call("join", { email: "joined@example.test", fail: false });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.data, true, "0.8 code still sees true");
  assert.equal(captured("joined@example.test"), null, "nothing is sent inside the request");
  const pinged = await call("ping", { to: "pinged@example.test" });
  assert.equal(pinged.body.data, true);

  runQueue();
  assert.equal(captured("joined@example.test"), "<p>Thanks for joining.</p>");
  assert.equal(captured("pinged@example.test"), "pong");
  assert.deepEqual(mailJobs().map((j) => j.state).sort(), ["done", "done"]);
  // The signup row committed with its mail.
  const rows = JSON.parse(wp("eval", `global $wpdb; echo wp_json_encode($wpdb->get_col("SELECT email FROM wp_import_${process.env.TP_SIGNUPS_HASH} ORDER BY id"));`));
  assert.deepEqual(rows, ["joined@example.test"]);
});
