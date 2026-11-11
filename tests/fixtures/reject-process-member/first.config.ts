import { action, defineConfig } from "first";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone",
  handler() { return process.cwd(); } }) } });
