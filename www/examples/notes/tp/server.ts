// The site's one public action: a published note gets one more cheer. The pages island and the
// `CheerButton` client component both call it.
import { action, integer, HttpError } from "typedpress";
import { notes, cheers } from "typedpress:db";

export const cheer = action({
  input: { noteId: integer() },
  access: "anyone",
  async handler({ noteId }) {
    const note = await notes.get({ id: noteId, status: "published" });
    if (!note) throw new HttpError(404, "not_found", "No published note has that id");
    const row = await cheers.get({ noteId });
    if (row) {
      await cheers.system.update(row.id, { count: row.count + 1 });
      return { count: row.count + 1 };
    }
    await cheers.system.create({ noteId, count: 1 });
    return { count: 1 };
  },
});
