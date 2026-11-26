import { defineConfig, global, text } from "spacepress";
export const settings = global({ tagline: text().searchable() });
export default defineConfig({});
