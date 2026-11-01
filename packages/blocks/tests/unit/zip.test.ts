import { test } from "node:test";
import assert from "node:assert/strict";

import { zip } from "../../src/compiler/zip.ts";

test("more entries than the classic format can count is refused rather than written with a wrong count", () => {
  const entries = Array.from({ length: 0x10000 }, (_, i) => ({ name: `f${i}`, data: new Uint8Array(0) }));
  assert.throws(() => zip(entries), RangeError);
});

test("an entry that does not shrink is stored, one that does is deflated, and both read back", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "zero-blocks-zip-"));
  try {
    const file = path.join(dir, "t.zip");
    writeFileSync(file, zip([{ name: "a/small.txt", data: new TextEncoder().encode("x") }, { name: "a/big.txt", data: new TextEncoder().encode("y".repeat(4096)) }]));
    const listing = execFileSync("unzip", ["-v", file], { encoding: "utf8" });
    assert.match(listing, /\s1\s+Stored\s.*a\/small\.txt/);
    assert.match(listing, /\s4096\s+Defl:[NX]\s.*a\/big\.txt/);
    assert.equal(execFileSync("unzip", ["-p", file, "a/big.txt"], { encoding: "utf8" }), "y".repeat(4096));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
