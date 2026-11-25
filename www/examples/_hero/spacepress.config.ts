// A whole app: a table and two actions in sp/tasks.ts, a page, and a list that stays interactive.
import { defineConfig } from "spacepress";

export * from "./sp/schema";

export default defineConfig({ name: "tasks" });
