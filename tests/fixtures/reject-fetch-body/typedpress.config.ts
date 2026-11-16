import { action, defineConfig, text } from "typedpress";
export const a = action({ input: { url: text() }, access: "anyone",
  async handler(i) { return (await fetch(i.url, { method: "POST", body: { a: 1 } })).status; } });

export default defineConfig({});
