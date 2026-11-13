import { collection, text, defineConfig } from "first";
const stockItems = collection({ title: text() }, { editor: false });
export default defineConfig({ collections: { stockItems } });
