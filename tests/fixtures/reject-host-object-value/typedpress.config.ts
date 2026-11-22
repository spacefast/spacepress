import { defineConfig, mutation } from "typedpress";
export const a = mutation({ access: "anyone" }, () => { return process ? "node" : "other"; });
export default defineConfig({});
