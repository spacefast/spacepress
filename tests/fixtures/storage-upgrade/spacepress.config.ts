import { table, defineConfig, f } from "spacepress";
export const stockItems = table({ title: f.text() }, { storageName: "stockItems", revisions: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export const stockLinks = table({ stockId: f.ref(stockItems).optional() }, { storageName: "stockLinks", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
const tables = { stockItems, stockLinks };
export default defineConfig({ name: "upgradeprobe" });
