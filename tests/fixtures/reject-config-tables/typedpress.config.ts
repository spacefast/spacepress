import { defineConfig, table, text } from "typedpress";
const variants = table({ name: text() });
export default defineConfig({ tables: { productVariants: variants } });
