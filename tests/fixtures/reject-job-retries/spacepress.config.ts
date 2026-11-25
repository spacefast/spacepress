import { collection, text, files, job, once, env, global, defineConfig, db, table } from "spacepress";
export const notes = table({ x: text().optional() });
export const bad = job({ retries: 21 }, () => {});

export default defineConfig({});
