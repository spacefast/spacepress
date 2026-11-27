import { collection, files, job, env, global, defineConfig, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = collection({ title: f.text().showIf({ title: "x" }) });
export default defineConfig({});
