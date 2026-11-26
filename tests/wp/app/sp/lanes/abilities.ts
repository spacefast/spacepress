// Lane fragment for the WP test app; only this lane edits this file. Every kind, action and job it
// exports registers under its export name, and a name another lane or the app uses fails the build.
import { adminScreen, item, query, mutation } from "spacepress";
import { db, HttpError } from "spacepress/server";
import { comments } from "../blog/spacepress.config.ts";
function refsHelper() { return 1; }
const refsSaved: { f?: () => number } = {};
/** Annotated from its options (spec §3a): reads only, so core runs it over GET. */
export const refsCount = query({ access: "anyone" }, async ({ body }: { body: string }) => {
  const rows = await db.query.comments.findMany({ where: { body }, columns: { id: true } });
  return { body, count: rows.length, ids: rows.map((r) => r.id) };
});

/** Destructive and idempotent: core runs it over DELETE. */
export const refsPurge = mutation({ access: "editor", destructive: true, idempotent: true }, async ({ body }: { body: string }) => {
  const gone = await db.delete(comments).where({ body }).returning();
  return gone.length;
});

/** Computed numbers that can't be finite (NaN, Infinity, 2^70): null on the wire; 1e20 literal kept. */
export const refsRatio = query({ access: "anyone" }, ({ n }: { n: number }): { ratio: number; big: 1e20; huge: number } => {
  if (!Number.isInteger(n)) throw new HttpError(422, "invalid_input", "n must be an integer", "/n");
  return { ratio: n / n, big: 1e20, huge: 2 ** (n * 70) };
});

export const refsEmpty = mutation({ access: "editor" }, () => ({}));

export const refsWire = mutation({ access: "editor" }, () => ({ f: refsHelper, a: [refsHelper, NaN] }));

export const refsEcho = mutation({ access: (ctx) => { refsSaved.f = refsHelper; return ctx.user?.role === "editor" || ctx.user?.role === "admin"; } }, (input: { meta?: unknown; info?: { tag?: string }; items?: ({ tag?: string })[] }) => {
  if (refsSaved.f && refsSaved.f !== refsHelper) throw new Error("named function identity changed across callbacks");
  return input.info ? { meta: input.meta, info: input.info } : { meta: input.meta };
});

/** Kept from discovery and MCP (§7.1). A named run still checks editor access. */
export const agentNote = mutation({ access: "editor", agents: false }, async ({ note }: { note: string }) => {
  if (note.length > 200) throw new HttpError(422, "invalid_input", "note must be at most 200 characters", "/note");
  const rows = await db.query.comments.findMany({ where: { body: note }, columns: { id: true } });
  return { note, seen: rows.length };
});
/** The rows a screen lists: readonly, so core runs it over GET. */
export const refsRows = query({ access: "editor" }, async () => {
  const rows = await db.query.comments.findMany({ columns: { id: true, body: true }, limit: 100 });
  return { rows };
});

/**
 * A screen declared in TypeScript (docs/admin-screens.md): compiled into schema.php and registered
 * on `sp_admin_screens` by the app plugin. admin.test.ts reads its declaration back.
 */
export const refsReview = adminScreen({
  title: "Comment bodies",
  description: "Every comment's body, from a TypeScript declaration.",
  access: "editor",
  classic: { parent: "tools.php" },
  menu: { icon: "dashicons-admin-comments" },
  view: {
    action: refsRows,
    items: "rows",
    fields: { id: { label: "ID", type: "integer" }, body: { label: "Body" } },
    layout: { type: "table", titleField: "body", fields: ["id"] },
  },
  actions: [{ id: "purge", label: "Purge", action: refsPurge, input: { body: item("body") }, confirm: "Delete every comment with this body?" }],
  data: ["Purging deletes every comment with the same body."],
});

/** Top-level options this lane owns (e.g. webhooks, media, locales). */
export const config = {};
