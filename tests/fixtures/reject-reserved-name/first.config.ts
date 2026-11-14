import { collection, text, defineConfig } from "first";
export const media = collection({ title: text() });
export default defineConfig({});
