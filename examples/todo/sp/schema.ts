import { createTasksCollection, createTodoBuckets, createTodoSettings } from "@spacepress/todo";

export const buckets = createTodoBuckets({
  label: "Buckets",
  sync: "content/buckets/*.md",
});

export const tasks = createTasksCollection({
  buckets,
  label: "Tasks",
  sync: "content/tasks/*.md",
  // Read-only anonymous preview of shared ("team") tasks for live demos; private tasks stay hidden and all writes stay authenticated.
  anonymousRead: true,
});

export const settings = createTodoSettings();
