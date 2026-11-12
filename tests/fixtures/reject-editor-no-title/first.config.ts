import { collection, text, defineConfig } from "first";
const notes = collection({ body: text().optional() });
export default defineConfig({ collections: { notes } });
