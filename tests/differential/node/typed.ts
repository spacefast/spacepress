// Node built-ins used from typed TypeScript, run once in Node and once as the generated PHP
// (tests/compiler_contracts.rs `node_modules_typed_use_matches_node`). Module values are checked
// JavaScript values; `as string` and `as number` check and narrow them.
import { defineConfig, mutation } from "spacepress";
import { createHash, createHmac, randomBytes } from "node:crypto";
import * as nodeCrypto from "node:crypto";

function signature(body: string): string {
  return createHmac("sha256", "key").update(Buffer.from(body)).digest().toString("base64") as string;
}

export const typedHashes = mutation({}, () => {
  const hex = createHash("sha256").update("a").update(Buffer.from("b")).digest("hex") as string;
  const h = createHmac("sha256", "k");
  h.update("x");
  const b64 = h.digest().toString("base64") as string;
  const n = (randomBytes(16) as Uint8Array).length as number;
  const viaNs = nodeCrypto.createHash("md5").update("").digest("base64url") as string;
  const sig: string = signature("payload");
  return [hex, b64, n, viaNs, sig, hex.length + sig.length];
});

export default defineConfig({ name: "node-typed" });
