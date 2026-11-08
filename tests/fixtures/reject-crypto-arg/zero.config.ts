import { action, crypto, defineConfig, text } from "zero";
export default defineConfig({ actions: { a: action({ input: { d: text() }, access: "anyone",
  handler(i) { return crypto.sha256(i.d); } }) } });
