import { boolean, defineConfig, integer, table, text } from "first";

const contacts = table({
  email: text().max(191).unique().optional(),
  active: boolean().default(false).optional(),
  parentId: integer().references(() => contacts.id, { onDelete: "set null" }).optional(),
}, { existingTable: "sf_migrate_index_contacts" });
const bookmarks = table({ contactId: integer().references(() => contacts.id, { onDelete: "set null" }).optional() });

export default defineConfig({ name: "adoption-indexes", tables: { bookmarks, contacts } });
