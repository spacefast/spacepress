import { table, defineConfig, f } from "spacepress";
export const stockItems = table({ title: f.text() }, { editor: false });
export default defineConfig({});
