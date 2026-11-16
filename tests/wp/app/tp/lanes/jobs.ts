// Lane fragment for the WP test app; only this lane edits this file. Every kind, action and job it
// exports registers under its export name, and a name another lane or the app uses fails the build.
// Lane D (§6.1): a hook that enqueues, a job with a visible effect that can be made to fail, and an
// idempotent action built on once().
import { action, boolean, collection, db, env, group, HttpError, integer, job, jobs, json, once, repeater, text, table } from "typedpress";
import { abilities } from "php/wordpress";

export const jobNotes = table({
  title: text(),
  fail: boolean().default(false),
  stamped: text().optional(),
}, { access: { create: "editor", read: "editor", update: "editor" } }).on({
  async afterCreate(row: { id: number; title: string; fail: boolean; stamped: string | null }) {
    await jobs.stamp.enqueue({ noteId: row.id, fail: row.fail });
    if (row.title === "Explode") throw new HttpError(500, "boom", "afterCreate exploded after enqueue");
  },
});

// Webhooks (D2) listen only here, so the job tests above never see webhook deliveries.
export const hookNotes = table({ title: text() },
  { access: { create: "editor", read: "editor" } });

export const refsEnqueue = action({
  input: { noteId: integer(), meta: json() }, access: "editor",
  handler: async (input) => {
    const queued = await jobs.stamp.enqueue({ noteId: input.noteId, meta: input.meta, info: {}, rows: [{}] });
    return { id: queued.id, sent: JSON.stringify(input.meta) };
  },
});

export const jobsOnce = action({
  input: { note: text() },
  access: "editor",
  idempotent: true,
  handler: async (input) => {
    const result = await once(`note-${input.note}`, async () => {
      const rows = await db.insert(jobNotes).values({ title: `once ${input.note}` }).returning();
      return { ids: rows.map((r) => r.id) };
    });
    return { ...result, f: () => 1 };
  },
});

// Runs the idempotent jobsOnce ability twice with different input: an Idempotency-Key sent for
// this action must not key those inner runs.
export const jobsTwice = action({
  input: { note: text() },
  access: "editor",
  handler: async (input) => {
    const a = await abilities.call("blog/jobs-once", { note: `${input.note}-a` });
    const b = await abilities.call("blog/jobs-once", { note: `${input.note}-b` });
    return { a, b };
  },
});

// Inbound webhook: an HMAC over the raw body replaces the access rule.
export const jobsInbound = action({
  input: { title: text() },
  signature: { secret: env("TP_WP_INBOUND_SECRET"), header: "typedpress-signature", scheme: "typedpress" },
  agents: false, // abilities pass no headers, so a signature can't be checked over MCP
  handler: async (input, ctx) => {
    await db.insert(jobNotes).values({ title: `inbound ${input.title}` });
    return { user: ctx.user };
  },
});

export const stamp = job({
  input: { noteId: integer(), fail: boolean().default(false), meta: json().optional(), info: group({}).optional(), rows: repeater({}).optional() },
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
});

/** Top-level options this lane owns (e.g. webhooks, media, locales). */
export const config = {
  webhooks: [{ url: env("TP_WP_HOOK_URL"), secret: env("TP_WP_HOOK_SECRET"), events: ["hook_notes.created"] }],
};
