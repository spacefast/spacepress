import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ x: f.json().default([env("SECRET")]).optional() });
export default defineConfig({});
