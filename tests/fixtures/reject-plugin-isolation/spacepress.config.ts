import { collection, defineConfig, text } from "spacepress";
import a from "spacepress-plugin-a";
import b from "spacepress-plugin-b";
export const posts = collection({ title: text() }, { title: "title" });
export default defineConfig({ name: "iso", use: [a(), b()] });
