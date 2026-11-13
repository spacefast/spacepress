// The database module, added by `first add db`. This file is yours: rename the tables, change the
// fields, or delete it all and start again.
//
// A table() is a real SQL table: typed columns, foreign keys and indexes. Use it for the data your
// app works on (orders, bookings, votes, anything you filter, sort, count or join). Keep
// collection() for what people write and publish in the WordPress editor.
//
// - Every exported table() registers under its export name: the typed client gets `first.tasks`,
//   and the API gets `/__first/api/v1/tasks`.
// - `first build` writes the SQL for each change here to first/_generated/migrations/. Commit that
//   folder and never edit it.
// - A deploy checks every change against the live rows before it runs any of them. Removing a table
//   or field that holds rows is refused until the deploy names the row count (`--drop=tasks=12`).
//   Rename with `was: "old_name"` on the table or `.was("old")` on a field and the rows stay.
import { boolean, date, integer, table, text } from "first";

export const projects = table({
  name: text().max(120),
  archived: boolean().default(false),
}, {
  // Who may do what. A role admits itself and every role above it:
  // subscriber < author < editor < admin.
  access: { read: "subscriber", create: "editor", update: "editor", delete: "editor" },
});

export const tasks = table({
  // A foreign key to projects.id: MySQL refuses a task without its project, and deleting a
  // project deletes its tasks.
  projectId: integer().references(() => projects.id, { onDelete: "cascade" }),
  title: text().max(200),
  done: boolean().default(false),
  dueOn: date().optional(),
}, {
  access: {
    read: "subscriber",
    create: "author",
    // A rule can be a function. Returning a filter limits the rule to the rows that match it:
    // here everyone below editor may change a task only while it is open.
    update: ({ user }) => (user?.role === "editor" || user?.role === "admin" ? true : { done: false }),
    delete: "editor",
  },
});

// Relations: to read a task with its project (`first.tasks.list({ with: { project: true } })`),
// declare the relation and list it in first.config.ts:
//
//   import { defineRelations } from "first";
//   import { projects, tasks } from "./first/tables";
//
//   const relations = defineRelations({ projects, tasks }, (r) => ({
//     tasks: { project: r.one.projects({ from: r.tasks.projectId, to: r.projects.id }) },
//     projects: { tasks: r.many.tasks() },
//   }));
//   export default defineConfig({ /* what you have */, relations });
//
// A relation can point at a collection() too: a table row can belong to a post.
