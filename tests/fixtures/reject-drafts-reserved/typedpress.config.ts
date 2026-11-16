import { collection, text, defineConfig } from "typedpress";
export const posts = collection({ title: text(), status: text().optional() });
export default defineConfig({});
