import { collection, defineConfig, text } from "first";
import x from "first-plugin-x";
export const posts = collection({ title: text(), summary: text().optional(), body: text().optional() }, { title: "title" });
export default defineConfig({ name: "w", use: [x()] });
