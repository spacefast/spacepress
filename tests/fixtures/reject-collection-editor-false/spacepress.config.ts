import { collection, text, defineConfig } from "spacepress";
export const stockItems = collection({ title: text() }, { editor: false });
export default defineConfig({});
