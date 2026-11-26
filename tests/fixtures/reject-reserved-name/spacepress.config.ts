import { collection, text, defineConfig } from "spacepress";
export const media = collection({ title: text() });
export default defineConfig({});
