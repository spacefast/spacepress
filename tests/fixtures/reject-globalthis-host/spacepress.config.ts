import { defineConfig, mutation } from "spacepress";
export const probe = mutation({}, () => typeof globalThis.Buffer);

export default defineConfig({ name: "globalthishost" });
