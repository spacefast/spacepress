// Lane fragment for the WP test app; only this lane edits this file. Every kind, action and job it
// exports registers under its export name, and a name another lane or the app uses fails the build.
import { action, db, group, integer, json, repeater, text } from "first";
import { comments } from "../blog/first.config.ts";
function refsHelper() { return 1; }
const refsSaved: { f?: () => number } = {};
/** Annotated from its options (spec §3a): reads only, so core runs it over GET. */
export const refsCount = action({
  input: { body: text() },
  access: "anyone",
  readonly: true,
  async handler({ body }) {
    const rows = await db.query.comments.findMany({ where: { body }, columns: { id: true } });
    return { body, count: rows.length, ids: rows.map((r) => r.id) };
  },
});

/** Destructive and idempotent: core runs it over DELETE. */
export const refsPurge = action({
  input: { body: text() },
  access: "editor",
  destructive: true,
  idempotent: true,
  async handler({ body }) {
    const gone = await db.delete(comments).where({ body }).returning();
    return gone.length;
  },
});

/** Computed numbers that can't be finite (NaN, Infinity, 2^70): null on the wire; 1e20 literal kept. */
export const refsRatio = action({
  input: { n: integer() },
  access: "anyone",
  readonly: true,
  handler({ n }): { ratio: number; big: 1e20; huge: number } {
    return { ratio: n / n, big: 1e20, huge: 2 ** (n * 70) };
  },
});

export const refsEmpty = action({ input: {}, access: "editor", handler: () => ({}) });

export const refsWire = action({ input: {}, access: "editor", handler: () => ({ f: refsHelper, a: [refsHelper, NaN] }) });

export const refsEcho = action({
  input: { meta: json().optional(), info: group({ tag: text().optional() }).optional(), items: repeater({ tag: text().optional() }).optional() },
  access: (ctx) => { refsSaved.f = refsHelper; return ctx.user?.role === "editor" || ctx.user?.role === "admin"; },
  handler: (input) => {
    if (refsSaved.f && refsSaved.f !== refsHelper) throw new Error("named function identity changed across callbacks");
    return input.info ? { meta: input.meta, info: input.info } : { meta: input.meta };
  },
});

/** Kept from agents (§7.1): an ability for PHP and `wp first run`, absent from core REST and MCP. */
export const agentNote = action({
  input: { note: text().max(200) },
  access: "editor",
  agents: false,
  async handler({ note }) {
    const rows = await db.query.comments.findMany({ where: { body: note }, columns: { id: true } });
    return { note, seen: rows.length };
  },
});
/** Top-level options this lane owns (e.g. webhooks, media, locales). */
export const config = {};
