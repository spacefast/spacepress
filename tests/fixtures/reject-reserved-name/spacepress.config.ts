import { collection, defineConfig, f } from "spacepress";
export const media = collection({ title: f.text() });
export default defineConfig({});
