import { defineConfig, table, id } from "zero";
import { tags } from "./zero/tags";
export default defineConfig({ tables: { items: table({ id: id() }) }, name: tags[0] });
