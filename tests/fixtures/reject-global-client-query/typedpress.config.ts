import { defineConfig, global, text } from "typedpress";
export const query = global({ label: text().optional() });
export default defineConfig({ name: "probe" });
