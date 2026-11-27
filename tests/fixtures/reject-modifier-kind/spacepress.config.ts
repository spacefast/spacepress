import { collection, defineConfig, table, f } from "spacepress";
export const a = table({ done: f.boolean().max(3).optional() });
export default defineConfig({});
