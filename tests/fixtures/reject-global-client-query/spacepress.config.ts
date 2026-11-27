import { defineConfig, global, f } from "spacepress";
export const query = global({ label: f.text().optional() });
export default defineConfig({ name: "probe" });
