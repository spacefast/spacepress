import { boolean, defineConfig, id, integer, table, text } from "first";

const contacts = table({
  id: id(),
  email: text().max(191).unique(),
  active: boolean().default(false),
  parentId: integer().references(() => contacts.id, { onDelete: "set null" }),
}, { existingTable: "sf_migrate_index_contacts" });
const bookmarks = table({ id: id(), contactId: integer().references(() => contacts.id, { onDelete: "set null" }) });

export default defineConfig({ name: "adoption-indexes", tables: { bookmarks, contacts } });
