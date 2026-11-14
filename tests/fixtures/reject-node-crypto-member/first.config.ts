import { action, defineConfig, text } from "first";
import { createCipheriv } from "node:crypto";
export const a = action({ input: { d: text() }, access: "anyone",
  handler(i) { return String(createCipheriv); } });

export default defineConfig({});
