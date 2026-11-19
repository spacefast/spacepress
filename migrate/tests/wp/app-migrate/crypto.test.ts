import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { api } from "../env.ts";

async function action(name: string, input: object): Promise<unknown> {
  const response = await fetch(`${api}/actions/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return (body as { data: unknown }).data;
}

test("migrated ctx.crypto calls give 0.8's digests and MACs, checked against Node", async () => {
  // Multi-byte UTF-8, so the digest is proven over bytes, not code units.
  const text = "first 0.8 → v2 ✓ 😀";
  assert.equal(await action("digest", { text }), createHash("sha256").update(text, "utf8").digest("hex"));
  const payload = '{"event":"paid","amount":1900}';
  // WEBHOOK_SECRET is a wp-config constant with surrounding spaces; 0.8 trimmed named keys.
  assert.deepEqual(await action("sign", { payload }), {
    inline: createHmac("sha256", "Jefe").update(payload).digest("hex"),
    named: createHmac("sha256", "lane-secret").update(payload).digest("hex"),
  });
  const good = createHmac("sha256", "lane-secret").update(payload).digest("hex");
  assert.equal(await action("verify", { body: payload, given: good }), true);
  assert.equal(await action("verify", { body: payload, given: good.slice(0, -1) + "0" }), false);
  assert.equal(await action("verify", { body: payload, given: "" }), false);
});
