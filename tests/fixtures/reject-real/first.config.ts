import { defineConfig, table, real } from "first";
const notes = table({ score: real() });
export default defineConfig({ tables: { notes } });
