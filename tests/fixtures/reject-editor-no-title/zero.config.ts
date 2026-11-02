import { collection, id, text, defineConfig } from "zero";
const notes = collection({ id: id(), body: text() });
export default defineConfig({ collections: { notes } });
