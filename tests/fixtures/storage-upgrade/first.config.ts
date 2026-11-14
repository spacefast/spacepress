import { table, text, integer, defineConfig, ref } from "first";
export const stockItems = table({ title: text() }, { storageName: "stockItems", revisions: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const stockLinks = table({ stockId: ref(stockItems).optional() }, { storageName: "stockLinks", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
const tables = { stockItems, stockLinks };
export default defineConfig({ name: "upgradeprobe" });
