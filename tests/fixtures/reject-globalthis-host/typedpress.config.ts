import { defineConfig, mutation } from "typedpress";
export const probe = mutation({}, () => typeof globalThis.Buffer);

export default defineConfig({ name: "globalthishost" });
