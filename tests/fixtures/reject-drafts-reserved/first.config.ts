import { collection, id, text, defineConfig } from "first";
const posts = collection({ id: id(), title: text().notNull(), status: text() });
export default defineConfig({ collections: { posts } });
