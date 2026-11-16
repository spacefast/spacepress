import { action, defineConfig, text } from "typedpress";
import { createHash } from "node:crypto";
export const a = action({ input: { d: text() }, access: "anyone",
  handler(i) { return createHash("sha256").update(i.d).digest().length; } });

export default defineConfig({});
