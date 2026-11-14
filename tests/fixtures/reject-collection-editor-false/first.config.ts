import { collection, text, defineConfig } from "first";
export const stockItems = collection({ title: text() }, { editor: false });
export default defineConfig({});
