import { collection, defineConfig, f } from "spacepress";
export const notes = collection({ title: f.text() });
export const posts = collection({ title: f.text(), topic: f.text() });
export default defineConfig({ name: "kindurlshape", permalinks: { notes: "/n/latest/:slug", posts: "/n/:topic/:id" } });
