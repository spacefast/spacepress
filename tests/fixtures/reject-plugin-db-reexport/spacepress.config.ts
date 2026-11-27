import { collection, defineConfig, f } from "spacepress";
import reach from "spacepress-plugin-reach";
export const posts = collection({ title: f.text() }, { title: "title" });
export default defineConfig({ name: "reach", use: [reach()] });
