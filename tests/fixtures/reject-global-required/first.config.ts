import { collection, text, global, defineConfig, table } from "first";
const a = table({  });
const site = global({ title: text() });
export default defineConfig({ tables: { a }, globals: { site } });
