import { collection, defineConfig, f } from "spacepress";
export const notes = collection({ title: f.text() });
export default defineConfig({ relations: {} });
