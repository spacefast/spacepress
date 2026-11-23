import { defineConfig, global, text } from "typedpress";
export const settings = global({ tagline: text().searchable() });
export default defineConfig({});
