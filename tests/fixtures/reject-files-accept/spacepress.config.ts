import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ x: f.text().optional() });
export const decks = files({ accept: ["pdf"], maxBytes: 100 });

export default defineConfig({});
