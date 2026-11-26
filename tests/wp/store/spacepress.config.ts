import { defineConfig, job, table, text, mutation } from "spacepress";
import { db, mail } from "spacepress/server";

// The build-store lane edits BUILD_LABEL per build: the same app, different action code.
export const notes = table({ title: text() }, { sync: "content/notes/*.json" });

// The host contract lane: a job a tick runs, which mails through the host's transport.
export const notify = job({}, async ({ title }: { title: string }) => {
  await mail.send({ from: "app@example.com", to: "editor@example.com", subject: `Added ${title}`, text: title });
});

export const add = mutation({ access: "anyone" }, async ({ title }: { title: string }) => {
  await db.insert(notes).values({ title });
  await notify.enqueue({ title });
  return { added: title };
});

export const which = mutation({ access: "anyone" }, async () => {
  const rows = await db.query.notes.findMany({ columns: { title: true } });
  return { build: "BUILD_LABEL", notes: rows.length };
});

export default defineConfig({
  name: "storelane",
});
