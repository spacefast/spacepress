import { collection, defineConfig, text } from "first";
const notes = collection({ title: text() });
export default defineConfig({ collections: { notes } });
