import { table, action, db } from "typedpress";
import { note } from "typedpress:db";
export const notes = table({  });
export const count = action({ input: {}, access: "anyone", handler: () => db.select().from(note) });
