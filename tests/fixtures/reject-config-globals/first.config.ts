import { defineConfig, global, text } from "first";
const settings = global({ title: text().default("Hello") });
export default defineConfig({ globals: { settings } });
