import { id, defineConfig, table } from "zero";
abstract class Foo {}
export default defineConfig({ tables: { a: table({ id: id() }) } });
