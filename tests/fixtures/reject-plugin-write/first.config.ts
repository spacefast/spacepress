import { collection, defineConfig, text } from "first";
import x from "first-plugin-x";
const posts = collection({ title: text(), summary: text().optional(), body: text().optional() }, { title: "title" });
export default defineConfig({ name: "w", collections: { posts }, use: [x()] });
