import { action, defineConfig, db, job, jobs, mail, table, text } from "first";

// The build-store lane edits BUILD_LABEL per build: the same app, different action code.
export const notes = table({ title: text() }, { sync: "content/notes/*.json" });

// The host contract lane: a job a tick runs, which mails through the host's transport.
export const notify = job({
  input: { title: text() },
  handler: async ({ title }) => {
    await mail.send({ from: "app@example.com", to: "editor@example.com", subject: `Added ${title}`, text: title });
  },
});

export const add = action({
  input: { title: text() },
  access: "anyone",
  async handler({ title }) {
    await db.insert(notes).values({ title });
    await jobs.notify.enqueue({ title });
    return { added: title };
  },
});

export const which = action({
  input: {},
  access: "anyone",
  async handler() {
    const rows = await db.query.notes.findMany({ columns: { title: true } });
    return { build: "BUILD_LABEL", notes: rows.length };
  },
});

export default defineConfig({
  name: "storelane",
});
