import { collection, defineConfig, f } from "spacepress";
import a from "spacepress-plugin-a";
import b from "spacepress-plugin-b";
export const posts = collection({ title: f.text() }, { title: "title" });
export default defineConfig({ name: "iso", use: [a(), b()] });
