import { collection, defineConfig, text } from "typedpress";
import x from "typedpress-plugin-x";
export const posts = collection({ title: text(), summary: text().optional(), body: text().optional() }, { title: "title" });
export default defineConfig({ name: "w", use: [x()] });
