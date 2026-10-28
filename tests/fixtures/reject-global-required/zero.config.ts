import { collection, id, text, global, defineConfig } from "zero";
const a = collection("a", { id: id() }, { editor: false });
const site = global("site", { title: text().notNull() });
export default defineConfig({ schema: { a }, globals: { site } });
