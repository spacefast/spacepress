// The site's one public action: a published note gets one more cheer. The pages island and the
// `CheerButton` client component both call it.
import { mutation } from "spacepress";
import { HttpError } from "spacepress/server";

export const cheer = mutation({ access: "anyone" }, async ({ db }, { noteId }: { noteId: number }) => {
  if (!Number.isInteger(noteId)) throw new HttpError(422, "invalid_input", "noteId must be an integer", "/noteId");
  const note = await db.system.notes.get({ id: noteId, status: "published" });
  if (!note) throw new HttpError(404, "not_found", "No published note has that id");
  const row = await db.system.cheers.get({ noteId });
  if (row) {
    await db.system.cheers.update(row.id, { count: row.count + 1 });
    return { count: row.count + 1 };
  }
  await db.system.cheers.create({ noteId, count: 1 });
  return { count: 1 };
});
