import { action, defineConfig, fetch, text } from "first";
export default defineConfig({ actions: { a: action({ input: { url: text() }, access: "anyone",
  async handler(i) { return (await fetch(i.url)).status; } }) } });
