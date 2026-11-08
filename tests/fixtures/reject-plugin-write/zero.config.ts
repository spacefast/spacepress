import { collection, defineConfig, id, text } from "zero";
import x from "zero-plugin-x";
const posts = collection({ id: id(), title: text().notNull(), summary: text(), body: text() }, { title: "title" });
export default defineConfig({ name: "w", collections: { posts }, use: [x()] });
