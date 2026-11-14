import { collection, text, defineConfig } from "first";
export const posts = collection({ title: text(), status: text().optional() });
export default defineConfig({});
