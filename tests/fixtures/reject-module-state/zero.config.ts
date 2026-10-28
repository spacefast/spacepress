import { collection, id, defineConfig } from "zero";
let count = 0;
const a = collection("a", { id: id() }, { editor: false });
export default defineConfig({ schema: { a }, hooks: { a: { afterCreate(row) { count = count + 1; } } } });
