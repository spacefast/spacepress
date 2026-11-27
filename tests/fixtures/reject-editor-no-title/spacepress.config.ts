import { collection, defineConfig, f } from "spacepress";
export const notes = collection({ body: f.text().optional() });
export default defineConfig({});
