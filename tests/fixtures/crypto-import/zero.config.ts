import { action, crypto, defineConfig, text } from "zero";
export default defineConfig({ actions: { a: action({ input: { d: text().notNull() }, access: "anyone",
  handler(i) { return { h: crypto.sha256(i.d), eq: crypto.timingSafeEqual(i.d, "x"), id: crypto.randomUUID() }; } }) } });
