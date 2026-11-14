import { action, defineConfig } from "first";
export const a = action({ input: {}, access: "anyone",
  handler() { return process ? "node" : "other"; } });
export default defineConfig({});
