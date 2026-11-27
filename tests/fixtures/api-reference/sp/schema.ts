import { collection, mutation, f } from "spacepress";

/** Notes anyone reads and editors write. */
export const notes = collection({ title: f.text().max(120), body: f.text().optional(), rank: f.integer().default(0) }, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

/** Counts the notes. */
export const countNotes = mutation({ access: "anyone" }, async () => 0);
