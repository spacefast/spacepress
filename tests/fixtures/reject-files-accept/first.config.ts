import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "first";
export const notes = table({ x: text().optional() });
export const decks = files({ accept: ["pdf"], maxBytes: 100 });

export default defineConfig({});
