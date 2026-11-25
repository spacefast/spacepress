import { defineConfig, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, async (i: { url: string }) => { return (await fetch(i.url, { method: "POST", body: { a: 1 } })).status; });

export default defineConfig({});
