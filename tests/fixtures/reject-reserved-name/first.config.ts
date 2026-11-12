import { collection, text, defineConfig } from "first";
const media = collection({ title: text() });
export default defineConfig({ collections: { media } });
