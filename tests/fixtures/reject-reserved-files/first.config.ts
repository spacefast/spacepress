import { collection, id, text, defineConfig } from "first";
const files = collection({ id: id(), title: text().notNull() });
export default defineConfig({ collections: { files } });
