import { action, defineConfig, text } from "first";
import { createCipheriv } from "node:crypto";
export default defineConfig({ actions: { a: action({ input: { d: text() }, access: "anyone",
  handler(i) { return String(createCipheriv); } }) } });
