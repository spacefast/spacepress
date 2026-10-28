import { collection, id, defineConfig } from "zero";
const v = Date.now();
export default defineConfig({ schema: { a: collection("a", { id: id() }, { editor: false }) } });
