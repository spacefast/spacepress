import { defineConfig, global, f } from "spacepress";
export const settings = global("settings", { title: f.text().default("Hi") });
export default defineConfig({ name: "named-global" });
