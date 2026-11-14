import { action, defineConfig } from "first";
export const a = action({ input: {}, access: "anyone",
  handler() { return navigator.userAgent; } });
export default defineConfig({});
