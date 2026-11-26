import { collection, defineConfig, text } from "spacepress";
import x from "spacepress-plugin-x";
export const posts = collection({ title: text(), summary: text().optional(), body: text().optional() }, { title: "title" });
export default defineConfig({ name: "w", use: [x()] });
