import { defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
async function touches(): Promise<boolean> { await db.audit.create({ note: "side effect" }); return true; }
async function reaches(): Promise<boolean> { return await touches(); }
export const audit = table({ note: f.text().optional(), flag: f.boolean().default(async () => await reaches()).optional() });
export const notes = table({ x: f.text().access({ read: () => reaches() === true }).optional() });
export default defineConfig({});
