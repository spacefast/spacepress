import { id, defineConfig, table } from "first";
abstract class Foo {}
export default defineConfig({ tables: { a: table({ id: id() }) } });
