import { collection, defineConfig, text } from "typedpress";
const notes = collection({ title: text() });
export default defineConfig({ collections: { notes } });
