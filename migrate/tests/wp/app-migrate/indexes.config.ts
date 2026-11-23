import { boolean, defineConfig, integer, table, text, ref } from "spacepress";

export const contacts = table({
  email: text().max(191).unique().optional(),
  active: boolean().default(false).optional(),
  parentId: ref(() => contacts).optional(),
}, { existingTable: "adopt_legacy_contacts" });
export const bookmarks = table({ contactId: ref(contacts).optional() });

export default defineConfig({ name: "adoption-indexes" });
