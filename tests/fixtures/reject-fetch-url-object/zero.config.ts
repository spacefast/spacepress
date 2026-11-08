import { action, defineConfig, text } from "zero";
export default defineConfig({ actions: { a: action({ input: { url: text().notNull() }, access: "anyone",
  async handler(i) { return (await fetch(new URL(i.url))).status; } }) } });
