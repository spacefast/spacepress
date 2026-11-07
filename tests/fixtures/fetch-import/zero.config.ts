import { action, defineConfig, fetch, text } from "zero";
export default defineConfig({ actions: { a: action({ input: { url: text().notNull() }, access: "anyone",
  async handler(i) { const r = await fetch(i.url); return { status: r.status, body: await r.text() }; } }) } });
