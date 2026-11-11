import { action, defineConfig, text } from "first";
export default defineConfig({ actions: { a: action({ input: { d: text().notNull() }, access: "anyone",
  async handler(i) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(i.d)); } }) } });
