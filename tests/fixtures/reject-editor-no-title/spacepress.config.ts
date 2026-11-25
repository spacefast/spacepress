import { collection, text, defineConfig } from "spacepress";
export const notes = collection({ body: text().optional() });
export default defineConfig({});
