import { collection, text, defineConfig } from "first";
export const notes = collection({ title: text().ui({ width: 101 }).optional() }, { title: "title" });
export default defineConfig({});
