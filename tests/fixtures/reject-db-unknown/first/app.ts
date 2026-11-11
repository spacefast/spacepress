import { table, id, action, db } from "first";
import { note } from "first:db";
export const notes = table({ id: id() });
export const count = action({ input: {}, access: "anyone", handler: () => db.select().from(note) });
