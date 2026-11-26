import { collection, text, defineConfig } from "spacepress";
export const notes = collection({ title: text() });
export default defineConfig({ relations: {} });
