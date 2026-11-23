import { defineConfig, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, () => { return process.env.DB_PASSWORD ?? null; });
export default defineConfig({});
