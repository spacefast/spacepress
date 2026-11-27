import { defineConfig, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, async (_ctx, i: { d: string }) => { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(i.d)); });

export default defineConfig({});
