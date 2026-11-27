import { defineConfig, global, f } from "spacepress";
const settings = global({ title: f.text().default("Hello") });
export default defineConfig({ globals: { settings } });
