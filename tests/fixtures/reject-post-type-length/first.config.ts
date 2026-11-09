import { collection, id, text, defineConfig } from "first";
const variants = collection({ id: id(), title: text().notNull() });
export default defineConfig({ collections: { productVariants: variants } });
