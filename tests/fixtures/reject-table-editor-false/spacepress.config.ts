import { table, text, defineConfig } from "spacepress";
export const stockItems = table({ title: text() }, { editor: false });
export default defineConfig({});
