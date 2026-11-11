import { action, defineConfig, text } from "first";
export default defineConfig({ actions: { a: action({ input: { name: text().notNull() }, access: "anyone",
  handler(i) { return process.env[i.name] ?? null; } }) } });
