import { action, defineConfig } from "typedpress";
export const a = action({ input: {}, access: "anyone",
  handler() { return navigator.userAgent; } });
export default defineConfig({});
