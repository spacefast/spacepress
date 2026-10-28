import { collection, id, text, integer, defineConfig } from "zero";
const a = collection("a", { id: id(), name: text() }, { editor: false });
const b = collection("b", { id: id(), aName: integer().references(() => a.name) }, { editor: false });
export default defineConfig({ schema: { a, b } });
