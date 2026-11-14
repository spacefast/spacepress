import { table, text, defineConfig } from "first";
export const stockItems = table({ title: text() }, { editor: false });
export default defineConfig({});
