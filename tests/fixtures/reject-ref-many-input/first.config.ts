import { action, defineConfig, ref, table, text } from "first";
const tags = table({ name: text() });
export default defineConfig({ tables: { tags }, actions: { bad: action({ input: { ids: ref(tags).many() }, handler: () => null }) } });
