import { collection, defineConfig, text } from "typedpress";
import reach from "typedpress-plugin-reach";
export const posts = collection({ title: text() }, { title: "title" });
export default defineConfig({ name: "reach", use: [reach()] });
