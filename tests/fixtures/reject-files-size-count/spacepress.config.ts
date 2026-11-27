import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ x: f.text().optional() });
export default defineConfig({ media: { sizes: {s0: { width: 1 }, s1: { width: 1 }, s2: { width: 1 }, s3: { width: 1 }, s4: { width: 1 }, s5: { width: 1 }, s6: { width: 1 }, s7: { width: 1 }, s8: { width: 1 }, s9: { width: 1 }, s10: { width: 1 }, s11: { width: 1 }, s12: { width: 1 }} } });
