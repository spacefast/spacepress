// A whole app in two files. Change anything and it is compiled again, here in your browser.
import { table, text, boolean, integer, defineConfig, action, db, HttpError } from "first";

export const tasks = table({
  title: text().min(1).max(120),
  done: boolean().default(false),
}, { access: { read: "anyone", create: "anyone", update: "anyone", delete: "editor" } });

// Try it: add `priority: integer().default(0),` to the table above and watch a migration appear.

export const finish = action({
  input: { id: integer() },
  access: "anyone",
  async handler({ id }) {
    const [task] = await db.update(tasks).set({ done: true }).where({ id }).returning();
    if (!task) throw new HttpError(404, "not_found", `No task ${id}`);
    return task;
  },
});

export default defineConfig({ name: "tasks", admin: false });
