import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startControl, stopControl, requestControl } from "./rebuild-service.mjs";

test("interrupted publication remains inspectable and cannot be replayed or overwritten", async () => {
  const state = await mkdtemp(join(tmpdir(), "first-rebuild-recovery-"));
  const id = "01234567-89ab-cdef-0123-456789abcdef";
  const jobFile = join(state, "builds", id, "job.json");
  await mkdir(join(state, "app/public"), { recursive: true });
  await mkdir(join(state, "builds", id), { recursive: true });
  await writeFile(
    join(state, "app/public/sources.json"),
    JSON.stringify({ revision: "baseline", files: { "first.config.ts": "source" } }),
  );
  await writeFile(jobFile, JSON.stringify({ id, status: "applying", message: "Publishing" }));
  try {
    // An offline daemon must not let the launcher overwrite an uncertain build.
    await assert.rejects(stopControl(state), /needs inspection/);
    await startControl({ state, env: { PRIVATE_TEST_SENTINEL: "host-only" } });
    const control = await requestControl(state);
    assert.equal(control.status, 200);
    assert.equal(control.body.available, false);
    assert.equal(control.body.recoveryRequired, true);
    const recovered = await requestControl(state, "GET", `/builds/${id}`);
    assert.equal(recovered.body.status, "interrupted");
    assert.equal(recovered.body.recoveryRequired, true);
    assert.match(recovered.body.message, /no automatic replay/);
    const retry = await requestControl(state, "POST", "/builds", {
      id: "11111111-1111-1111-1111-111111111111",
      baseRevision: "baseline",
      files: { "first.config.ts": "source" },
    });
    assert.equal(retry.status, 409);
    assert.match(retry.body.message, /inspection/);
    await assert.rejects(stopControl(state), /needs inspection/);
    assert.deepEqual(await readdir(join(state, "control")), ["control.sock"]);
    assert.deepEqual(await readdir(join(state, "builds")), [id]);
    assert.equal(JSON.parse(await readFile(jobFile, "utf8")).status, "interrupted");
    // Only this test's synthetic journal is resolved; no DB effects exist.
    await writeFile(jobFile, JSON.stringify({ id, status: "failed", recoveryRequired: false }));
    await requestControl(state, "POST", "/shutdown");
    await startControl({ state });
    assert.equal((await requestControl(state)).body.available, true);
  } finally {
    // This test owns only a synthetic journal, so no database needs recovery.
    try {
      await requestControl(state, "POST", "/shutdown");
    } finally {
      await rm(state, { recursive: true, force: true });
    }
  }
});
