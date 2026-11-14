import { collection, text, defineConfig } from "first";
export const search = collection({ title: text() });
export default defineConfig({});
