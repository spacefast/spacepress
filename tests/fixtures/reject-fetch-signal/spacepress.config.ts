import { defineConfig, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, async (i: { url: string }) => { return (await fetch(i.url, { signal: AbortSignal.timeout(5000) })).status; });

export default defineConfig({});
