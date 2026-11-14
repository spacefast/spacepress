import { collection, text, defineConfig } from "first";
export const notes = collection({ title: text() });
export default defineConfig({ relations: {} });
