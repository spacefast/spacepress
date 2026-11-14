import { collection, text, defineConfig } from "first";
export const files = collection({ title: text() });
export default defineConfig({});
