import { collection, defineConfig, f } from "spacepress";
export const search = collection({ title: f.text() });
export default defineConfig({});
