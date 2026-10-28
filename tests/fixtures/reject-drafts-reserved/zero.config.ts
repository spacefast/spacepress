import { collection, id, text, defineConfig } from "zero";
const posts = collection("posts", { id: id(), title: text().notNull(), status: text() });
export default defineConfig({ schema: { posts } });
