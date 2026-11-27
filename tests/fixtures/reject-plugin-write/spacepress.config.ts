import { collection, defineConfig, f } from "spacepress";
import x from "spacepress-plugin-x";
export const posts = collection({ title: f.text(), summary: f.text().optional(), body: f.text().optional() }, { title: "title" });
export default defineConfig({ name: "w", use: [x()] });
