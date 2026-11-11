import { collection, id, text, defineConfig } from "first";
const notes = collection({ id: id(), title: text().ui({ width: 101 }) }, { title: "title" });
export default defineConfig({ collections: { notes } });
