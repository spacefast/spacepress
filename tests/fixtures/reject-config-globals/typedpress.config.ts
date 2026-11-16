import { defineConfig, global, text } from "typedpress";
const settings = global({ title: text().default("Hello") });
export default defineConfig({ globals: { settings } });
