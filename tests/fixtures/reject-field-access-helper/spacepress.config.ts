import { boolean, collection, defineConfig, text, table } from "spacepress";
import { db } from "spacepress/server";
async function touches(): Promise<boolean> { await db.insert(audit).values({ note: "side effect" }); return true; }
async function reaches(): Promise<boolean> { return await touches(); }
export const audit = table({ note: text().optional(), flag: boolean().$default(async () => await reaches()).optional() });
export const notes = table({ x: text().access({ read: () => reaches() === true }).optional() });
export default defineConfig({});
