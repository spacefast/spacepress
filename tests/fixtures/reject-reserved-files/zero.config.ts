import { collection, id, text, defineConfig } from "zero";
const files = collection("files", { id: id(), title: text().notNull() });
export default defineConfig({ schema: { files } });
