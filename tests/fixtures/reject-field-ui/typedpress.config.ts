import { collection, text, defineConfig } from "typedpress";
export const notes = collection({ title: text().ui({ width: 101 }).optional() }, { title: "title" });
export default defineConfig({});
