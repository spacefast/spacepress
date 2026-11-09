import { action, defineConfig, text } from "first";
export default defineConfig({ actions: { a: action({ input: { url: text().notNull() }, access: "anyone",
  async handler(i) { return (await fetch(i.url, { method: "POST", body: { a: 1 } })).status; } }) } });
