import { action, defineConfig, db, table, text } from "zero";

// The build-store lane edits BUILD_LABEL per build: the same app, different action code.
const notes = table({ title: text().notNull() }, { sync: "content/notes/*.json" });

export default defineConfig({
  name: "storelane",
  tables: { notes },
  actions: {
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
