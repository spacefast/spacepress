import { defineConfig, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, async (i: { url: string }) => { const r = await fetch(i.url); return r.body === null; });

export default defineConfig({});
