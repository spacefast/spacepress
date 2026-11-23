import { collection, defineConfig, text } from "spacepress";
import reach from "spacepress-plugin-reach";
export const posts = collection({ title: text() }, { title: "title" });
export default defineConfig({ name: "reach", use: [reach()] });
