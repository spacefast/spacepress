import { defineConfig, table, id } from "first";
import { tags } from "./first/tags";
export default defineConfig({ tables: { items: table({ id: id() }) }, name: tags[0] });
