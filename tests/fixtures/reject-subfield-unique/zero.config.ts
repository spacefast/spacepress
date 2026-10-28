import { collection, id, text, group, defineConfig } from "zero";
const a = collection("a", { id: id(), meta: group({ fields: { code: text().unique() } }) }, { editor: false });
export default defineConfig({ schema: { a } });
