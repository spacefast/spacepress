import { collection, text, defineConfig } from "typedpress";
export const notes = collection({ title: text() });
export default defineConfig({ relations: {} });
