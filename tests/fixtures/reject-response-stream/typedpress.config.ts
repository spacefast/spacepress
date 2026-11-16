import { action, defineConfig, text } from "typedpress";
export const a = action({ input: { url: text() }, access: "anyone",
  async handler(i) { const r = await fetch(i.url); return r.body === null; } });

export default defineConfig({});
