// A typed client for the tables in first/tables.ts, added by `first add db`. Import these
// functions from your frontend, or copy the calls. `first build` regenerates the client's types
// from your schema, so a renamed field is a type error here.
import { createClient } from "./first/_generated/client/index.ts";

const first = createClient({ url: "/__first/api/v1" });

/** The open tasks of one project by due date; tasks with no date come first. At most 50 unless you pass `limit`. */
export function openTasks(projectId: number) {
  return first.tasks.list({ where: { projectId, done: false }, orderBy: { dueOn: "asc" } });
}

export function addTask(projectId: number, title: string) {
  return first.tasks.create({ projectId, title });
}

export function finishTask(id: number) {
  return first.tasks.update(id, { done: true });
}
