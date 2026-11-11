import { collection, defineConfig, id, text } from "first";
import a from "first-plugin-a";
import b from "first-plugin-b";
const posts = collection({ id: id(), title: text().notNull() }, { title: "title" });
export default defineConfig({ name: "iso", collections: { posts }, use: [a(), b()] });
