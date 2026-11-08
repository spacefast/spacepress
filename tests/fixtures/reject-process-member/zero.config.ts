import { action, defineConfig } from "zero";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone",
  handler() { return process.cwd(); } }) } });
