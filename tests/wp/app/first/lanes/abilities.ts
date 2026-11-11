// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
import { action, db, group, integer, json, repeater, text } from "first";
import { comments } from "../blog/first.config.ts";

export const collections = {  };
export const tables = {  };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
function refsHelper() { return 1; }
const refsSaved: { f?: () => number } = {};
export const actions = {
  /** Annotated from its options (spec §3a): reads only, so core runs it over GET. */
  refsCount: action({
    input: { body: text().notNull() },
    access: "anyone",
    readonly: true,
    async handler({ body }) {
      const rows = await db.query.comments.findMany({ where: { body }, columns: { id: true } });
      return { body, count: rows.length, ids: rows.map((r) => r.id) };
    },
  }),
  /** Destructive and idempotent: core runs it over DELETE. */
  refsPurge: action({
    input: { body: text().notNull() },
    access: "editor",
    destructive: true,
    idempotent: true,
    async handler({ body }) {
      const gone = await db.delete(comments).where({ body }).returning();
      return gone.length;
    },
  }),
  /** Computed numbers that can't be finite (NaN, Infinity, 2^70): null on the wire; 1e20 literal kept. */
  refsRatio: action({
    input: { n: integer().notNull() },
    access: "anyone",
    readonly: true,
    handler({ n }): { ratio: number; big: 1e20; huge: number } {
      return { ratio: n / n, big: 1e20, huge: 2 ** (n * 70) };
    },
  }),
  refsEmpty: action({ input: {}, access: "editor", handler: () => ({}) }),
  refsWire: action({ input: {}, access: "editor", handler: () => ({ f: refsHelper, a: [refsHelper, NaN] }) }),
  refsEcho: action({
    input: { meta: json(), info: group({ fields: { tag: text() } }), items: repeater({ fields: { tag: text() } }) },
    access: (ctx) => { refsSaved.f = refsHelper; return ctx.user?.role === "editor" || ctx.user?.role === "admin"; },
    handler: (input) => {
      if (refsSaved.f && refsSaved.f !== refsHelper) throw new Error("named function identity changed across callbacks");
      return input.info ? { meta: input.meta, info: input.info } : { meta: input.meta };
    },
  }),
  /** Kept from agents (§7.1): an ability for PHP and `wp first run`, absent from core REST and MCP. */
  agentNote: action({
    input: { note: text().notNull().max(200) },
    access: "editor",
    agents: false,
    async handler({ note }) {
      const rows = await db.query.comments.findMany({ where: { body: note }, columns: { id: true } });
      return { note, seen: rows.length };
    },
  }),
};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {};
