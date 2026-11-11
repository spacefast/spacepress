import { collection, id, text, defineConfig } from "first";
const notes = collection({ id: id(), body: text() });
export default defineConfig({ collections: { notes } });
