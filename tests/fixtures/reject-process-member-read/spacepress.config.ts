import { defineConfig, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, () => { return process.arch; });
export default defineConfig({});
