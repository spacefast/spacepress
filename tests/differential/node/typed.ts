// Node built-ins used from typed TypeScript, run once in Node and once as the generated PHP
// (tests/compiler_contracts.rs `node_modules_typed_use_matches_node`). Module values are checked
// JavaScript values; `as string` and `as number` check and narrow them.
import { defineConfig, mutation } from "spacepress";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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

export const typedBuffers = mutation({}, () => {
  const body: Buffer = Buffer.from("héllo wörld");
  const copy = Buffer.alloc(body.length as number);
  body.copy(copy);
  const joined = Buffer.concat([body, Buffer.from([0x21])]);
  const bytes: Uint8Array = new TextEncoder().encode("ok");
  const decoded = new TextDecoder().decode(Buffer.from(bytes)) as string;
  return [
    joined.toString("base64") as string,
    copy.equals(body) as boolean,
    Buffer.byteLength("é😀") as number,
    Buffer.isBuffer(joined) as boolean,
    decoded,
    JSON.stringify({ b: Buffer.from("ab") }),
    String(Buffer.from("x")),
  ];
});

export const typedScalarResults = mutation({}, () => {
  const digest: string = nodeCrypto.createHash("sha256").update("a").update("b").digest("hex");
  const random: string = randomBytes(8).toString("hex");
  const uuid: string = randomUUID();
  const equal: boolean = timingSafeEqual(Buffer.from("a"), Buffer.from("a"));
  const length: number = Buffer.byteLength("é");
  return [digest, random.length, uuid.length, equal, length];
});

export const typedWebCrypto = mutation({}, async () => {
  const data: Uint8Array = new TextEncoder().encode("payload");
  const digest: ArrayBuffer = await crypto.subtle.digest("SHA-256", data);
  const view: Uint8Array = new Uint8Array(8);
  const same = crypto.getRandomValues(view) === view;
  return [Buffer.from(digest).toString("hex") as string, same, typeof crypto];
});

export default defineConfig({ name: "node-typed" });
