import { collection, text, defineConfig } from "first";
const notes = collection({ title: text() });
export default defineConfig({ collections: { notes }, relations: {} });
