import { action, defineConfig, db, job, jobs, mail, table, text } from "first";

// The build-store lane edits BUILD_LABEL per build: the same app, different action code.
const notes = table({ title: text().notNull() }, { sync: "content/notes/*.json" });

export default defineConfig({
  name: "storelane",
  tables: { notes },
  jobs: {
    // The host contract lane: a job a tick runs, which mails through the host's transport.
    notify: job({
      input: { title: text().notNull() },
      handler: async ({ title }) => {
        await mail.send({ from: "app@example.com", to: "editor@example.com", subject: `Added ${title}`, text: title });
      },
    }),
  },
  actions: {
    add: action({
      input: { title: text().notNull() },
      access: "anyone",
      async handler({ title }) {
        await db.insert(notes).values({ title });
        await jobs.notify.enqueue({ title });
        return { added: title };
      },
    }),
    which: action({
      input: {},
      access: "anyone",
      async handler() {
        const rows = await db.query.notes.findMany({ columns: { title: true } });
        return { build: "BUILD_LABEL", notes: rows.length };
      },
    }),
  },
});
