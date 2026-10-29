import { collection, id, text, group, defineConfig } from "zero";
// The rule sits on a nested sub-field: the check reaches every level.
const authors = collection("authors", { id: id(), name: text().notNull(), contact: group({ fields: { phone: text().access({ read: "editor" }) } }) }, { editor: false });
export default defineConfig({ schema: { authors } });
