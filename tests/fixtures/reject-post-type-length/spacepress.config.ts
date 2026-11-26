import { collection, text, defineConfig } from "spacepress";
const variants = collection({ title: text() });
export { variants as productVariantsLong };

export default defineConfig({});
