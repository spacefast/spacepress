import { defineConfig, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, () => { return process ? "node" : "other"; });
export default defineConfig({});
