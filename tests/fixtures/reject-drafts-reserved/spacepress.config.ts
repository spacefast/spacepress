import { collection, text, defineConfig } from "spacepress";
export const posts = collection({ title: text(), status: text().optional() });
export default defineConfig({});
