// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
import { action, db, json, text } from "zero";
import { comments } from "../../../fixtures/blog/zero.config.ts";

export const schema = {};
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
function refsHelper() { return 1; }
export const actions = {
  refsEmpty: action({ input: {}, access: "editor", handler: () => ({}) }),
  refsWire: action({ input: {}, access: "editor", handler: () => ({ f: refsHelper, a: [refsHelper, NaN] }) }),
  refsEcho: action({ input: { meta: json() }, access: "editor", handler: (input) => ({ meta: input.meta }) }),
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
