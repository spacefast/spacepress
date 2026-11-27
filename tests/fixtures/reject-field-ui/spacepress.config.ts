import { collection, defineConfig, f } from "spacepress";
export const notes = collection({ title: f.text().ui({ width: 101 }).optional() }, { title: "title" });
export default defineConfig({});
