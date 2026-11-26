import { table, mutation } from "spacepress";
import { db } from "spacepress/server";
import { note } from "spacepress/server/db";
export const notes = table({  });
export const count = mutation({ access: "anyone" }, () => db.select().from(note));
