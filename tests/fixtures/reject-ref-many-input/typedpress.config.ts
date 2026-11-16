import { action, defineConfig, ref, table, text } from "typedpress";
export const tags = table({ name: text() });
export const bad = action({ input: { ids: ref(tags).many() }, handler: () => null });

export default defineConfig({});
