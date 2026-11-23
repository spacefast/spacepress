import { table, db, mutation } from "spacepress";
import { note } from "spacepress:db";
export const notes = table({  });
export const count = mutation({ access: "anyone" }, () => db.select().from(note));
