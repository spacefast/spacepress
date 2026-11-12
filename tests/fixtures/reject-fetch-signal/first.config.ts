import { action, defineConfig, text } from "first";
export default defineConfig({ actions: { a: action({ input: { url: text() }, access: "anyone",
  async handler(i) { return (await fetch(i.url, { signal: AbortSignal.timeout(5000) })).status; } }) } });
