import { action, defineConfig } from "first";
const windows = process.platform === "win32";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone",
  handler() { return windows; } }) } });
