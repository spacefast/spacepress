import { defineConfig, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, (_ctx, i: { name: string }) => { return process.env[i.name] ?? null; });

export default defineConfig({});
