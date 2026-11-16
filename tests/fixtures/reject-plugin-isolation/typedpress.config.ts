import { collection, defineConfig, text } from "typedpress";
import a from "typedpress-plugin-a";
import b from "typedpress-plugin-b";
export const posts = collection({ title: text() }, { title: "title" });
export default defineConfig({ name: "iso", use: [a(), b()] });
