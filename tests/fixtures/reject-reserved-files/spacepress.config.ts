import { collection, text, defineConfig } from "spacepress";
export const files = collection({ title: text() });
export default defineConfig({});
