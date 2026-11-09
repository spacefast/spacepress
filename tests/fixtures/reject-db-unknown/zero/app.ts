import { table, id, action, db } from "zero";
import { note } from "zero:db";
export const notes = table({ id: id() });
export const count = action({ input: {}, access: "anyone", handler: () => db.select().from(note) });
