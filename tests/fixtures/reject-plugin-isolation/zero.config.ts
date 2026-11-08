import { collection, defineConfig, id, text } from "zero";
import a from "zero-plugin-a";
import b from "zero-plugin-b";
const posts = collection({ id: id(), title: text().notNull() }, { title: "title" });
export default defineConfig({ name: "iso", collections: { posts }, use: [a(), b()] });
