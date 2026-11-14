import { defineConfig, global, text } from "first";
const query = global({ label: text().optional() });
export default defineConfig({ name: "probe", globals: { query } });
