import { collection, id, text, defineConfig } from "first";
const media = collection({ id: id(), title: text().notNull() });
export default defineConfig({ collections: { media } });
