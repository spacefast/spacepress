import { collection, text, defineConfig } from "typedpress";
export const stockItems = collection({ title: text() }, { editor: false });
export default defineConfig({});
