import { defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ x: f.text().access({ read: () => db.notes.list().length > 0 }).optional() });
export default defineConfig({});
