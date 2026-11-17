import { defineConfig, mutation } from "typedpress";
export const a = mutation({ access: "anyone" }, () => { return process.env.DB_PASSWORD ?? null; });
export default defineConfig({});
