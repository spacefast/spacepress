import { collection, id, defineConfig } from "zero";
class Foo {}
export default defineConfig({ schema: { a: collection("a", { id: id() }, { editor: false }) } });
