// The table and the two actions that write it. Change anything and it is compiled again, here in your browser.
import { table, text, boolean, integer, db, HttpError, mutation } from "spacepress";

export const tasks = table({
  title: text().min(1).max(120),
  done: boolean().default(false),
}, { access: { read: "anyone", create: "anyone", update: "anyone", delete: "editor" } });

// Try it: add `priority: integer().default(0),` to the table above and watch a migration appear.

export const addTask = mutation({ access: "anyone" }, async ({ title }: { title: string }) => {
  if (title.length < 1) throw new HttpError(422, "invalid_input", "title must be at least 1 character", "/title");
  if (title.length > 120) throw new HttpError(422, "invalid_input", "title must be at most 120 characters", "/title");
  const [task] = await db.insert(tasks).values({ title }).returning();
  return task;
});

export const setDone = mutation({ access: "anyone" }, async ({ id, done }: { id: number; done: boolean }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const [task] = await db.update(tasks).set({ done }).where({ id }).returning();
  if (!task) throw new HttpError(404, "not_found", `No task ${id}`);
  return task;
});
