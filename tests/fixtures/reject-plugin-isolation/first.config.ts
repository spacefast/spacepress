import { collection, defineConfig, text } from "first";
import a from "first-plugin-a";
import b from "first-plugin-b";
const posts = collection({ title: text() }, { title: "title" });
export default defineConfig({ name: "iso", collections: { posts }, use: [a(), b()] });
