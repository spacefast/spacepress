import { collection, id, text, defineConfig } from "zero";
const media = collection({ id: id(), title: text().notNull() });
export default defineConfig({ collections: { media } });
