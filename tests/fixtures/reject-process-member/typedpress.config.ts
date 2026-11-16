import { action, defineConfig } from "typedpress";
export const a = action({ input: {}, access: "anyone",
  handler() { return process.cwd(); } });

export default defineConfig({});
