import { action, defineConfig } from "typedpress";
export const a = action({ input: {}, access: "anyone",
  handler() { return process.arch; } });
export default defineConfig({});
