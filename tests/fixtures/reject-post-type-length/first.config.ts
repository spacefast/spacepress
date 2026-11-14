import { collection, text, defineConfig } from "first";
const variants = collection({ title: text() });
export { variants as productVariants };

export default defineConfig({});
