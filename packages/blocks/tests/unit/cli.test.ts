import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { main } from "../../src/cli.ts";
import { fixture } from "./helpers.ts";

function run(argv: string[]) {
  let stdout = "";
  let stderr = "";
  return main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) }).then((code) => ({ code, stdout, stderr }));
}

test("content writes markup to --out and exits 0; errors go to stderr as file:line:col and exit 1 with nothing written", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "zero-blocks-cli-"));
  try {
    const out = path.join(dir, "pricing.html");
    const ok = await run(["content", fixture("pricing.tsx"), "--out", out]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(ok.stdout, "");
    assert.match(readFileSync(out, "utf8"), /^<!-- wp:heading/);

    const bad = await run(["content", fixture("styled.tsx"), "--out", path.join(dir, "styled.html")]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /styled\.tsx:5:7 style_prop_unsupported: /);
    assert.throws(() => readFileSync(path.join(dir, "styled.html")));

    const json = await run(["content", fixture("styled.tsx"), "--json"]);
    assert.equal(json.code, 1);
    const parsed = JSON.parse(json.stderr) as { code: string; line: number; column: number; file: string }[];
    assert.deepEqual(parsed.map((d) => [d.code, path.basename(d.file), d.line, d.column]), [["style_prop_unsupported", "styled.tsx", 5, 7], ["unmappable_element", "styled.tsx", 6, 9]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usage mistakes exit 2 with the usage text", async () => {
  assert.equal((await run([])).code, 2);
  assert.equal((await run(["content"])).code, 2);
  const unknown = await run(["content", "x.tsx", "--nope"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown flag --nope/);
});
