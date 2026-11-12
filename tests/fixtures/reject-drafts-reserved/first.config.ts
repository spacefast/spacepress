import { collection, text, defineConfig } from "first";
const posts = collection({ title: text(), status: text().optional() });
export default defineConfig({ collections: { posts } });
