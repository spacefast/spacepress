import { defineConfig, global, text } from "spacepress";
const settings = global({ title: text().default("Hello") });
export default defineConfig({ globals: { settings } });
