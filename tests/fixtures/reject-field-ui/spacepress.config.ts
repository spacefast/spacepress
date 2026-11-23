import { collection, text, defineConfig } from "spacepress";
export const notes = collection({ title: text().ui({ width: 101 }).optional() }, { title: "title" });
export default defineConfig({});
