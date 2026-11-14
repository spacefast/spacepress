import { defineConfig, global, text } from "first";
export const settings = global("settings", { title: text().default("Hi") });
export default defineConfig({ name: "named-global" });
