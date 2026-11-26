import { collection, text, defineConfig } from "spacepress";
export const search = collection({ title: text() });
export default defineConfig({});
