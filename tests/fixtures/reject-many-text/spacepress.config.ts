import { defineConfig, table, f } from "spacepress";
export const notes = table({ names: f.text().many() });
export default defineConfig({});
