import { defineConfig, table, text } from "spacepress";
const variants = table({ name: text() });
export default defineConfig({ tables: { productVariants: variants } });
