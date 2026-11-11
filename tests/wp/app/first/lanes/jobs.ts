// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
// Lane D (§6.1): a hook that enqueues, a job with a visible effect that can be made to fail, and an
// idempotent action built on once().
import { action, boolean, collection, db, env, group, HttpError, id, integer, job, jobs, json, once, repeater, text, table } from "first";

export const jobNotes = table({
  id: id(),
  title: text().notNull(),
  fail: boolean().notNull().default(false),
  stamped: text(),
}, { access: { create: "editor", read: "editor", update: "editor" } });

// Webhooks (D2) listen only here, so the job tests above never see webhook deliveries.
export const hookNotes = table({ id: id(), title: text().notNull() },
  { access: { create: "editor", read: "editor" } });

export const collections = {  };
export const tables = { jobNotes, hookNotes };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
export const actions = {
  refsEnqueue: action({
    input: { noteId: integer().notNull(), meta: json().notNull() }, access: "editor",
    handler: async (input) => {
      const queued = await jobs.stamp.enqueue({ noteId: input.noteId, meta: input.meta, info: {}, rows: [{}] });
      return { id: queued.id, sent: JSON.stringify(input.meta) };
    },
  }),
  jobsOnce: action({
    input: { note: text().notNull() },
    access: "editor",
    idempotent: true,
    handler: async (input) => {
      const result = await once(`note-${input.note}`, async () => {
        const rows = await db.insert(jobNotes).values({ title: `once ${input.note}` }).returning();
        return { ids: rows.map((r) => r.id) };
      });
      return { ...result, f: () => 1 };
    },
  }),
  // Inbound webhook: an HMAC over the raw body replaces the access rule.
  jobsInbound: action({
    input: { title: text().notNull() },
    signature: { secret: env("FIRST_WP_INBOUND_SECRET"), header: "first-signature", scheme: "first" },
    agents: false, // abilities pass no headers, so a signature can't be checked over MCP
    handler: async (input, ctx) => {
      await db.insert(jobNotes).values({ title: `inbound ${input.title}` });
      return { user: ctx.user };
    },
  }),
};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {
  jobNotes: {
    async afterCreate(row: { id: number; title: string; fail: boolean; stamped: string | null }) {
      await jobs.stamp.enqueue({ noteId: row.id, fail: row.fail });
      if (row.title === "Explode") throw new HttpError(500, "boom", "afterCreate exploded after enqueue");
    },
  },
};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {
  webhooks: [{ url: env("FIRST_WP_HOOK_URL"), secret: env("FIRST_WP_HOOK_SECRET"), events: ["hook_notes.created"] }],
  jobs: {
    stamp: job({
      input: { noteId: integer().notNull(), fail: boolean().notNull().default(false), meta: json(), info: group({ fields: {} }), rows: repeater({ fields: {} }) },
      retries: 2,
      agents: true, // also the `blog/job-stamp` ability (lane F)
      handler: async (input, ctx) => {
        if (input.info !== null && Object.keys(input.info!).length !== 0) throw new Error("empty group changed");
        if (input.rows !== null && input.rows.length > 0 && Object.keys(input.rows![0]!).length !== 0) throw new Error("empty repeater item changed");
        if (input.fail) {
          // Write first: the failure must roll this back on WordPress's connection.
          await db.update(jobNotes).set({ stamped: `partial ${ctx.attempt}` }).where({ id: input.noteId });
          throw new Error(`stamp failed on attempt ${ctx.attempt}`);
        }
        await db.update(jobNotes).set({ stamped: input.meta !== null ? JSON.stringify(input.meta) : `${ctx.jobId}:${ctx.attempt}` }).where({ id: input.noteId });
      },
    }),
  },
};
