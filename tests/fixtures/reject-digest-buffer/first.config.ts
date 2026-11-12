import { action, defineConfig, text } from "first";
import { createHash } from "node:crypto";
export default defineConfig({ actions: { a: action({ input: { d: text() }, access: "anyone",
  handler(i) { return createHash("sha256").update(i.d).digest().length; } }) } });
