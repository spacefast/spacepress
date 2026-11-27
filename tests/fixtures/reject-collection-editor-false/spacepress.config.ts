import { collection, defineConfig, f } from "spacepress";
export const stockItems = collection({ title: f.text() }, { editor: false });
export default defineConfig({});
