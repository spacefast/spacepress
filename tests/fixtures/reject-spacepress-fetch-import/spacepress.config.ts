import { defineConfig, fetch, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, async (i: { url: string }) => { return (await fetch(i.url)).status; });

export default defineConfig({});
