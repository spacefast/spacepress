import { collection, id, defineConfig } from "zero";
let i = 0; while (true) { i++; }
export default defineConfig({ schema: { a: collection("a", { id: id() }, { editor: false }) } });
