// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
// Lane D (§6.1): a hook that enqueues, a job with a visible effect that can be made to fail, and an
// idempotent action built on once().
import { action, boolean, collection, db, HttpError, id, integer, job, jobs, once, text } from "zero";

export const jobNotes = collection("jobNotes", {
  id: id(),
  title: text().notNull(),
  fail: boolean().notNull().default(false),
  stamped: text(),
}, { editor: false, access: { create: "editor", read: "editor", update: "editor" } });

export const schema = { jobNotes };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
export const actions = {
  jobsOnce: action({
    input: { note: text().notNull() },
    access: "editor",
    idempotent: true,
    handler: async (input) => await once(`note-${input.note}`, async () => {
      const rows = await db.insert(jobNotes).values({ title: `once ${input.note}` }).returning();
      return { ids: rows.map((r) => r.id) };
    }),
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
  jobs: {
    stamp: job({
      input: { noteId: integer().notNull(), fail: boolean().notNull().default(false) },
      retries: 2,
      handler: async (input, ctx) => {
        if (input.fail) {
          // Write first: the failure must roll this back on WordPress's connection.
          await db.update(jobNotes).set({ stamped: `partial ${ctx.attempt}` }).where({ id: input.noteId });
          throw new Error(`stamp failed on attempt ${ctx.attempt}`);
        }
        await db.update(jobNotes).set({ stamped: `${ctx.jobId}:${ctx.attempt}` }).where({ id: input.noteId });
      },
    }),
  },
};
