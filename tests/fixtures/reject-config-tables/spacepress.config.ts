import { defineConfig, table, f } from "spacepress";
const variants = table({ name: f.text() });
export default defineConfig({ tables: { productVariants: variants } });
