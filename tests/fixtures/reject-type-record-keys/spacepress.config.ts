import { defineConfig, mutation } from "spacepress";
type Flags = Record<"ready" | "visible", boolean>;
export const example = mutation({}, () => { const value: Flags = { ready: true }; return value; });

export default defineConfig({});
