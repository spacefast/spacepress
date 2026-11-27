import { collection, defineConfig, f } from "spacepress";
import widget from "spacepress-plugin-widget";
export const posts = collection({ title: f.text() }, { title: "title" });
export default defineConfig({ name: "widget", use: [widget()] });
