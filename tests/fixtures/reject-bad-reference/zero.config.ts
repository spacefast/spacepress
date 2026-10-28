import { collection, id, text, integer, defineConfig } from "zero";
const a = collection("a", { id: id(), name: text() });
const b = collection("b", { id: id(), aName: integer().references(() => a.name) });
export default defineConfig({ schema: { a, b } });
