import { defineConfig, mutation } from "typedpress";
export const a = mutation({ access: "anyone" }, () => { return process.arch; });
export default defineConfig({});
