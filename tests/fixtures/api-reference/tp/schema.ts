import { action, collection, integer, text } from "typedpress";

/** Notes anyone reads and editors write. */
export const notes = collection({ title: text().max(120), body: text().optional(), rank: integer().default(0) }, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

/** Counts the notes. */
export const countNotes = action({
  access: "anyone",
  handler: async () => 0,
});
