import { defineConfig, global, text } from "spacepress";
export const query = global({ label: text().optional() });
export default defineConfig({ name: "probe" });
