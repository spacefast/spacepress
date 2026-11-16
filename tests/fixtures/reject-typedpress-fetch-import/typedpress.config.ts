import { action, defineConfig, fetch, text } from "typedpress";
export const a = action({ input: { url: text() }, access: "anyone",
  async handler(i) { return (await fetch(i.url)).status; } });

export default defineConfig({});
