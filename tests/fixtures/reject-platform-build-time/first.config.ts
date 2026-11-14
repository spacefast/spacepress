import { action, defineConfig } from "first";
const windows = process.platform === "win32";
export const a = action({ input: {}, access: "anyone",
  handler() { return windows; } });
export default defineConfig({});
