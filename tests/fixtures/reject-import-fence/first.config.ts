import { defineConfig, table } from "first";
import { tags } from "./first/tags";
export default defineConfig({ tables: { items: table({  }) }, name: tags[0] });
