import { table, text, integer, defineConfig, defineRelations } from "first";
const stockItems = table({ title: text() }, { storageName: "stockItems", revisions: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
const stockLinks = table({ stockId: integer().references(() => stockItems.id, { onDelete: "set null" }).optional() }, { storageName: "stockLinks", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
const tables = { stockItems, stockLinks };
const relations = defineRelations(tables, r => ({ stockLinks: { stock: r.one.stockItems({ from: r.stockLinks.stockId, to: r.stockItems.id }) } }));
export default defineConfig({ name: "upgradeprobe", tables, relations });
