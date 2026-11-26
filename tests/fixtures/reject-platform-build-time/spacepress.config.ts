import { defineConfig, mutation } from "spacepress";
const windows = process.platform === "win32";
export const a = mutation({ access: "anyone" }, () => { return windows; });
export default defineConfig({});
