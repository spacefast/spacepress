import { collection, defineConfig, text } from "spacepress";
const notes = collection({ title: text() });
export default defineConfig({ collections: { notes } });
