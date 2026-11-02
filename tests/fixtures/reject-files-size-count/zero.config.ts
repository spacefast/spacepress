import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "zero";
const notes = table({ id: id(), x: text() });
export default defineConfig({ tables: { notes }, media: { sizes: {s0: { width: 1 }, s1: { width: 1 }, s2: { width: 1 }, s3: { width: 1 }, s4: { width: 1 }, s5: { width: 1 }, s6: { width: 1 }, s7: { width: 1 }, s8: { width: 1 }, s9: { width: 1 }, s10: { width: 1 }, s11: { width: 1 }, s12: { width: 1 }} } });
