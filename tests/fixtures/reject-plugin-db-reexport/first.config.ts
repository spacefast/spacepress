import { collection, defineConfig, text } from "first";
import reach from "first-plugin-reach";
export const posts = collection({ title: text() }, { title: "title" });
export default defineConfig({ name: "reach", use: [reach()] });
