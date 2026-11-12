import { boolean, collection, db, defineConfig, text, table } from "first";
async function touches(): Promise<boolean> { await db.insert(audit).values({ note: "side effect" }); return true; }
async function reaches(): Promise<boolean> { return await touches(); }
const audit = table({ note: text().optional(), flag: boolean().$default(async () => await reaches()).optional() });
const notes = table({ x: text().access({ read: () => reaches() === true }).optional() });
export default defineConfig({ tables: { audit, notes } });
