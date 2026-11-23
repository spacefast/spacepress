import { collection, defineConfig, text } from "spacepress";
export const notes = collection({ title: text() }, { url: "/n/latest/:slug" });
export const posts = collection({ title: text(), topic: text() }, { url: "/n/:topic/:id" });
export default defineConfig({ name: "kindurlshape" });
