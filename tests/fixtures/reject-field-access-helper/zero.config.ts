import { boolean, collection, db, defineConfig, id, text, table } from "zero";
async function touches(): Promise<boolean> { await db.insert(audit).values({ note: "side effect" }); return true; }
async function reaches(): Promise<boolean> { return await touches(); }
const audit = table({ id: id(), note: text(), flag: boolean().$default(async () => await reaches()) });
const notes = table({ id: id(), x: text().access({ read: () => reaches() === true }) });
export default defineConfig({ tables: { audit, notes } });
