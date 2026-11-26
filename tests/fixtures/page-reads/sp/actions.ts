import { db, mutation } from "spacepress";
import { notes } from "spacepress:db";

// An action's `db` is trusted (spec §3): it reads every row, as the system does.
export const trustedTitles = mutation({ access: "anyone" }, async () => {
  const rows = await db.query.notes.findMany({ orderBy: { id: "asc" } });
  return rows.map((n) => n.title).join(",");
});

// The kind API from "spacepress:db" reads as the action's caller.
export const visitorTitles = mutation({ access: "anyone" }, async () => {
  const rows = await notes.list({ orderBy: { id: "asc" } });
  return rows.map((n) => n.title).join(",");
});
