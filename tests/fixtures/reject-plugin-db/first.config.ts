import { collection, defineConfig, id, text } from "first";
import reach from "first-plugin-reach";
const posts = collection({ id: id(), title: text().notNull() }, { title: "title" });
export default defineConfig({ name: "reach", collections: { posts }, use: [reach()] });
