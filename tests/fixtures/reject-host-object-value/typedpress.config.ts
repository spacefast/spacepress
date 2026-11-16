import { action, defineConfig } from "typedpress";
export const a = action({ input: {}, access: "anyone",
  handler() { return process ? "node" : "other"; } });
export default defineConfig({});
