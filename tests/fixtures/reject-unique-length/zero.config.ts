import { collection, id, text, defineConfig } from "zero";
const a = collection("a", { id: id(), code: text().unique() }, { editor: false });
export default defineConfig({ schema: { a } });
