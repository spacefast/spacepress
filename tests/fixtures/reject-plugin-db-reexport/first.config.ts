import { collection, defineConfig, text } from "first";
import reach from "first-plugin-reach";
const posts = collection({ title: text() }, { title: "title" });
export default defineConfig({ name: "reach", collections: { posts }, use: [reach()] });
