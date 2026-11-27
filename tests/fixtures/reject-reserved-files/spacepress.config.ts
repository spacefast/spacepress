import { collection, defineConfig, f } from "spacepress";
export const files = collection({ title: f.text() });
export default defineConfig({});
