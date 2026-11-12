import { collection, text, defineConfig } from "first";
const files = collection({ title: text() });
export default defineConfig({ collections: { files } });
