import { action, crypto, defineConfig, text } from "zero";
export default defineConfig({ actions: { a: action({ input: { d: text().notNull() }, access: "anyone",
  handler(i) { return crypto.sha265(i.d); } }) } });
