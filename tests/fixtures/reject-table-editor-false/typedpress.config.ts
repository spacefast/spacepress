import { table, text, defineConfig } from "typedpress";
export const stockItems = table({ title: text() }, { editor: false });
export default defineConfig({});
