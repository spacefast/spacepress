import { collection, text, files, job, env, global, defineConfig, table } from "spacepress";
import { once, db } from "spacepress/server";
export const notes = table({ x: text().optional() });
export const bad = job({ retries: 21 }, () => {});

export default defineConfig({});
