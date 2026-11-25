import { collection, boolean, defineConfig, table } from "spacepress";
export const a = table({ done: boolean().max(3).optional() });
export default defineConfig({});
