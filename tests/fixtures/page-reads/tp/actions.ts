import { action, db } from "typedpress";
import { notes } from "typedpress:db";

// An action's `db` is trusted (spec §3): it reads every row, as the system does.
export const trustedTitles = action({ input: {}, access: "anyone", async handler() {
  const rows = await db.query.notes.findMany({ orderBy: { id: "asc" } });
  return rows.map((n) => n.title).join(",");
} });

// The kind API from "typedpress:db" reads as the action's caller.
export const visitorTitles = action({ input: {}, access: "anyone", async handler() {
  const rows = await notes.list({ orderBy: { id: "asc" } });
  return rows.map((n) => n.title).join(",");
} });
