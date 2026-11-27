import { collection, files, job, env, global, defineConfig, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = collection({ title: f.text().access({ read: false }) });
export default defineConfig({});
