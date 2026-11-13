import { collection, text, defineConfig } from "first";
const search = collection({ title: text() });
export default defineConfig({ collections: { search } });
