import { collection, defineConfig, table } from "spacepress";
let count = 0;
export const a = table({  }).on({ afterCreate(row) { count = count + 1; } });
export default defineConfig({});
