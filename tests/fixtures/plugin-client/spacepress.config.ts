import { collection, defineConfig, text } from "spacepress";
import widget from "spacepress-plugin-widget";
export const posts = collection({ title: text() }, { title: "title" });
export default defineConfig({ name: "widget", use: [widget()] });
