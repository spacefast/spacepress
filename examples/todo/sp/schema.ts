import { createTasksCollection, createTodoBuckets, createTodoSettings } from "@spacepress/todo";

export const buckets = createTodoBuckets({
  label: "Buckets",
  sync: "content/buckets/*.md",
});

export const tasks = createTasksCollection({
  buckets,
  label: "Tasks",
  url: "/tasks/:slug",
  sync: "content/tasks/*.md",
  // Read-only anonymous preview for live demos; all writes stay authenticated.
  anonymousRead: true,
});

export const settings = createTodoSettings();
