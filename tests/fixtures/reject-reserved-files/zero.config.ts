import { collection, id, text, defineConfig } from "zero";
const files = collection({ id: id(), title: text().notNull() });
export default defineConfig({ collections: { files } });
