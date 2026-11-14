import { defineConfig, global, text } from "first";
export const query = global({ label: text().optional() });
export default defineConfig({ name: "probe" });
