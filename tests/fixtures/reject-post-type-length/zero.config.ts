import { collection, id, text, defineConfig } from "zero";
const variants = collection("product_variants", { id: id(), title: text().notNull() });
export default defineConfig({ schema: { variants } });
