import { collection, text, defineConfig } from "typedpress";
const variants = collection({ title: text() });
export { variants as productVariantsLong };

export default defineConfig({});
