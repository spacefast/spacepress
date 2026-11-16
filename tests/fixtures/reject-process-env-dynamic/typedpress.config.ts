import { action, defineConfig, text } from "typedpress";
export const a = action({ input: { name: text() }, access: "anyone",
  handler(i) { return process.env[i.name] ?? null; } });

export default defineConfig({});
