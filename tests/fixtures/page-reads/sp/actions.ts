import { mutation } from "spacepress";

// `db.system` bypasses visitor rules: it reads every row, as the system does.
export const trustedTitles = mutation({ access: "anyone" }, async ({ db }) => {
  const rows = await db.system.notes.list({ orderBy: { id: "asc" } });
  return rows.map((n) => n.title).join(",");
});

// `db.<kind>` reads as the action's caller.
export const visitorTitles = mutation({ access: "anyone" }, async ({ db }) => {
  const rows = await db.notes.list({ orderBy: { id: "asc" } });
  return rows.map((n) => n.title).join(",");
});
