import { defineConfig, table, text } from "first";
const variants = table({ name: text() });
export default defineConfig({ tables: { productVariants: variants } });
