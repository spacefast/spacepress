import { collection, text, defineConfig } from "first";
export const notes = collection({ body: text().optional() });
export default defineConfig({});
