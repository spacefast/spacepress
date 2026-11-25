// Lane fragment for the WP test app; only this lane edits this file. Every kind, action and job it
// exports registers under its export name, and a name another lane or the app uses fails the build.
// Lane D (§6.1): a hook that enqueues, a job with a visible effect that can be made to fail, and an
// idempotent action built on once().
import { boolean, collection, db, env, HttpError, job, once, text, table, mutation } from "spacepress";
import { abilities } from "php/wordpress";

export const jobNotes = table({
  title: text(),
  fail: boolean().default(false),
  stamped: text().optional(),
}, { access: { create: "editor", read: "editor", update: "editor" } }).on({
  async afterCreate(row) {
    await stamp.enqueue({ noteId: row.id, fail: row.fail });
    if (row.title === "Explode") throw new HttpError(500, "boom", "afterCreate exploded after enqueue");
  },
});

// Webhooks (D2) listen only here, so the job tests above never see webhook deliveries.
export const hookNotes = table({ title: text() },
  { access: { create: "editor", read: "editor" } });

export const refsEnqueue = mutation({ access: "editor" }, async (input: { noteId: number; meta: unknown }) => {
  if (!Number.isInteger(input.noteId)) throw new HttpError(422, "invalid_input", "noteId must be an integer", "/noteId");
  const queued = await stamp.enqueue({ noteId: input.noteId, meta: input.meta, info: {}, rows: [{}] });
  return { id: queued.id, sent: JSON.stringify(input.meta) };
});

// Ten calls a minute per caller, held open for a moment so concurrent calls overlap in the database.
export const jobsLimited = mutation({ access: "editor", rateLimit: "10/min" }, async ({ wait }: { wait: number }) => {
  const until = Date.now() + wait;
  while (Date.now() < until) { /* hold the caller's transaction open */ }
  return 1;
});

export const jobsOnce = mutation({ access: "editor", idempotent: true }, async (input: { note: string }) => {
  const result = await once(`note-${input.note}`, async () => {
    const rows = await db.insert(jobNotes).values({ title: `once ${input.note}` }).returning();
    return { ids: rows.map((r) => r.id) };
  });
  return { ...result, f: () => 1 };
});

// Runs the idempotent jobsOnce ability twice with different input: an Idempotency-Key sent for
// this action must not key those inner runs.
export const jobsTwice = mutation({ access: "editor" }, async (input: { note: string }) => {
  const a = await abilities.call("blog/jobs-once", { note: `${input.note}-a` });
  const b = await abilities.call("blog/jobs-once", { note: `${input.note}-b` });
  return { a, b };
});

// Inbound webhook: an HMAC over the raw body replaces the access rule.
// `agents: false`: abilities pass no headers, so a signature can't be checked over MCP.
export const jobsInbound = mutation({ signature: { secret: env("SP_WP_INBOUND_SECRET"), header: "spacepress-signature", scheme: "spacepress" }, agents: false }, async (input: { title: string }, ctx) => {
  await db.insert(jobNotes).values({ title: `inbound ${input.title}` });
  return { user: ctx.user };
});

// Also the `blog/job-stamp` ability (lane F).
export const stamp = job({ retries: 2, agents: true }, async (input: { noteId: number; fail?: boolean; meta?: unknown; info?: {}; rows?: {}[] }, ctx) => {
  if (!Number.isInteger(input.noteId)) throw new HttpError(422, "invalid_input", "noteId must be an integer", "/noteId");
  if (input.info !== undefined && Object.keys(input.info).length !== 0) throw new Error("empty group changed");
  if (input.rows !== undefined && input.rows.length > 0 && Object.keys(input.rows[0]!).length !== 0) throw new Error("empty repeater item changed");
  if (input.fail) {
    // Write first: the failure must roll this back on WordPress's connection.
    await db.update(jobNotes).set({ stamped: `partial ${ctx.attempt}` }).where({ id: input.noteId });
    throw new Error(`stamp failed on attempt ${ctx.attempt}`);
  }
  await db.update(jobNotes).set({ stamped: input.meta !== undefined ? JSON.stringify(input.meta) : `${ctx.jobId}:${ctx.attempt}` }).where({ id: input.noteId });
});

/** Top-level options this lane owns (e.g. webhooks, media, locales). */
export const config = {
  webhooks: [{ url: env("SP_WP_HOOK_URL"), secret: env("SP_WP_HOOK_SECRET"), events: ["hook_notes.created"] }],
};
