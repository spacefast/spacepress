import { action, defineConfig, text } from "first";
export default defineConfig({ actions: { a: action({ input: { url: text() }, access: "anyone",
  async handler(i) { const r = await fetch(i.url); return r.body === null; } }) } });
