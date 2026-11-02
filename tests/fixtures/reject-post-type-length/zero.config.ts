import { collection, id, text, defineConfig } from "zero";
const variants = collection({ id: id(), title: text().notNull() });
export default defineConfig({ collections: { productVariants: variants } });
