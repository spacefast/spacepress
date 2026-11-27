import { collection, defineConfig, f } from "spacepress";
export const posts = collection({ title: f.text(), status: f.text().optional() });
export default defineConfig({});
