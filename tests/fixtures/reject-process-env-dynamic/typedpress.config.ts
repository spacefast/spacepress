import { defineConfig, mutation } from "typedpress";
export const a = mutation({ access: "anyone" }, (i: { name: string }) => { return process.env[i.name] ?? null; });

export default defineConfig({});
