import { defineConfig, mutation } from "typedpress";
const windows = process.platform === "win32";
export const a = mutation({ access: "anyone" }, () => { return windows; });
export default defineConfig({});
