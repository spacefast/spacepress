import { collection, id, defineConfig } from "zero";
abstract class Foo {}
export default defineConfig({ schema: { a: collection("a", { id: id() }, { editor: false }) } });
