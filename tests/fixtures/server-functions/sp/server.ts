import { query, mutation, job, cron, table, text, integer } from "spacepress";
import { HttpError } from "spacepress/server";

export const notes = table({ title: text(), stamped: text().optional() }, { access: { read: "anyone" } });
export const ticks = table({ by: text() }, { access: { read: "anyone" } });

// Reads: the input is the parameter type; an optional field takes its destructuring default.
export const recent = query({ access: "anyone" },
  async ({ limit = 2, prefix }: { limit?: number; prefix?: string }) => {
    const rows = await notes.list({ orderBy: { id: "desc" }, limit });
    return rows.map((row) => (prefix ?? "") + row.title);
  });

// Writes in one transaction, and queues a job on its own export.
export const add = mutation({ access: "anyone", rateLimit: "3/min" },
  async ({ title, fail = false }: { title: string; fail?: boolean }) => {
    if (title.length > 20) throw new HttpError(422, "invalid_input", "title must be at most 20 characters", "/title");
    const row = await notes.system.create({ title });
    await stamp.enqueue({ id: row.id }, { key: `note-${row.id}` });
    if (fail) throw new HttpError(409, "rolled_back", "the write and its job roll back together");
    return { id: row.id };
  });

// A mutation open to anyone with no rateLimit gets the default.
export const open = mutation({ access: "anyone" }, async () => 1);

export const stamp = job({ retries: 1 }, async ({ id }: { id: number }) => {
  await notes.system.update(id, { stamped: "yes" });
});

export const hourly = job({ every: "1h" }, async () => {
  await ticks.system.create({ by: "every" });
});

export const nightly = cron("0 3 * * *", async () => {
  await ticks.system.create({ by: "cron" });
});

// Structured input: the site checks it against the parameter type, not only the scalars.
export const tag = mutation({ access: "anyone", rateLimit: false },
  async ({ who, tags, note }: { who: { name: string; age?: number }; tags: string[]; note: string | null }) =>
    `${who.name}:${tags.join(",")}:${note ?? "none"}`);
