import { collection, defineConfig, f } from "spacepress";
const notes = collection({ title: f.text() });
export default defineConfig({ collections: { notes } });
