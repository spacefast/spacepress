import { collection, id, text, defineConfig } from "zero";
const a = collection("a", { id: id(), name: text().notNull() }, { editor: false });
export default defineConfig({ schema: { a }, hooks: { a: { beforeCreat(d) {} } } });
