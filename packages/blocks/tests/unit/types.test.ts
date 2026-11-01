import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { fixture } from "./helpers.ts";

const require = createRequire(import.meta.url);

/**
 * The generated component types and the theme's token types are checked by
 * `tsc` on a fixture: every `@ts-expect-error` line must be an error (an
 * unused directive is itself an error), every other line must typecheck.
 */
test("a mistyped attribute, an unknown token, or a half-specified query loop is a type error, and the correct forms are not", () => {
  const tsc = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  let output = "";
  try {
    output = execFileSync(process.execPath, [tsc, "-p", fixture("types/tsconfig.json")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    assert.fail(`tsc reported errors:\n${failed.stdout ?? ""}${failed.stderr ?? ""}`);
  }
  assert.equal(output.trim(), "");
});
