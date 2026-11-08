import { action, defineConfig, text } from "zero";
import { createHash } from "node:crypto";
export default defineConfig({ actions: { a: action({ input: { d: text().notNull() }, access: "anyone",
  handler(i) { return createHash("sha256").update(i.d).digest().length; } }) } });
