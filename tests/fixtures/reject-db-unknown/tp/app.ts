import { table, db, mutation } from "typedpress";
import { note } from "typedpress:db";
export const notes = table({  });
export const count = mutation({ access: "anyone" }, () => db.select().from(note));
