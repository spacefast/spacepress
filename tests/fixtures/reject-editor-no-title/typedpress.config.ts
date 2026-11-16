import { collection, text, defineConfig } from "typedpress";
export const notes = collection({ body: text().optional() });
export default defineConfig({});
