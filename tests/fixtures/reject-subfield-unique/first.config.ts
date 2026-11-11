import { collection, id, text, group, defineConfig, table } from "first";
const a = table({ id: id(), meta: group({ fields: { code: text().unique() } }) });
export default defineConfig({ tables: { a } });
