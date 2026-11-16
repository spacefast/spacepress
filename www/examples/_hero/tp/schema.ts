// The table and the two actions that write it. Change anything and it is compiled again, here in your browser.
import { table, text, boolean, integer, action, db, HttpError } from "typedpress";

export const tasks = table({
  title: text().min(1).max(120),
  done: boolean().default(false),
}, { access: { read: "anyone", create: "anyone", update: "anyone", delete: "editor" } });

// Try it: add `priority: integer().default(0),` to the table above and watch a migration appear.

export const addTask = action({
  input: { title: text().min(1).max(120) },
  access: "anyone",
  async handler({ title }) {
    const [task] = await db.insert(tasks).values({ title }).returning();
    return task;
  },
});

export const setDone = action({
  input: { id: integer(), done: boolean() },
  access: "anyone",
  async handler({ id, done }) {
    const [task] = await db.update(tasks).set({ done }).where({ id }).returning();
    if (!task) throw new HttpError(404, "not_found", `No task ${id}`);
    return task;
  },
});
