import { defineConfig, mutation } from "typedpress";
export const a = mutation({ access: "anyone" }, async (i: { d: string }) => { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(i.d)); });

export default defineConfig({});
