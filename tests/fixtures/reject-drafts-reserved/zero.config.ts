import { collection, id, text, defineConfig } from "zero";
const posts = collection({ id: id(), title: text().notNull(), status: text() });
export default defineConfig({ collections: { posts } });
