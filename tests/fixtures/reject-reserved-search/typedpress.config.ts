import { collection, text, defineConfig } from "typedpress";
export const search = collection({ title: text() });
export default defineConfig({});
