import { collection, id, text, defineConfig } from "zero";
const media = collection("media", { id: id(), title: text().notNull() });
export default defineConfig({ schema: { media } });
