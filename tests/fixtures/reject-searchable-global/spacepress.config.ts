import { defineConfig, global, f } from "spacepress";
export const settings = global({ tagline: f.text().searchable() });
export default defineConfig({});
