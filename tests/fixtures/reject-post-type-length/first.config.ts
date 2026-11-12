import { collection, text, defineConfig } from "first";
const variants = collection({ title: text() });
export default defineConfig({ collections: { productVariants: variants } });
