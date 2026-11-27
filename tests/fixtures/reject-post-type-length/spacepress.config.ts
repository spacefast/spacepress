import { collection, defineConfig, f } from "spacepress";
const variants = collection({ title: f.text() });
export { variants as productVariantsLong };

export default defineConfig({});
