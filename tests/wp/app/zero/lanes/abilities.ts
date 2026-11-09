// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
import { action, db, group, json, repeater, text } from "zero";
import { comments } from "../blog/zero.config.ts";

export const collections = {  };
export const tables = {  };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
function refsHelper() { return 1; }
const refsSaved: { f?: () => number } = {};
export const actions = {
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
  /** Kept from agents (§7.1): an ability for PHP and `wp zero run`, absent from core REST and MCP. */
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
