import { boolean, collection, db, defineConfig, id, text } from "zero";
async function touches(): Promise<boolean> { await db.insert(audit).values({ note: "side effect" }); return true; }
async function reaches(): Promise<boolean> { return await touches(); }
const audit = collection("audit", { id: id(), note: text(), flag: boolean().$default(async () => await reaches()) }, { editor: false });
const notes = collection("notes", { id: id(), x: text().access({ read: () => reaches() === true }) }, { editor: false });
export default defineConfig({ schema: { audit, notes } });
