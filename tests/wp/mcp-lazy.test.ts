import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { wp } from "./env.ts";

test("MCP discovery and internal dispatch work without eager projections", () => {
  const script = readFileSync(new URL("./fixtures/mcp-lazy.php", import.meta.url), "utf8").replace(/^<\?php\s*/, "");
  assert.equal(wp("eval", script), "MCP lazy projection passed");
});
