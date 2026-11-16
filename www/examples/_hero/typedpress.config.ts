// A whole app: a table and two actions in tp/tasks.ts, a page, and a list that stays interactive.
import { defineConfig } from "typedpress";

export * from "./tp/schema";

export default defineConfig({ name: "tasks" });
