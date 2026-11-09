import { collection, defineConfig, id, text } from "zero";
import reach from "zero-plugin-reach";
const posts = collection({ id: id(), title: text().notNull() }, { title: "title" });
export default defineConfig({ name: "reach", collections: { posts }, use: [reach()] });
