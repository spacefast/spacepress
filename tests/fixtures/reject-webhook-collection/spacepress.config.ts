import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, table } from "spacepress";
export const notes = table({ x: text().optional() });
export default defineConfig({ webhooks: [{ url: env("HOOK_URL"), secret: env("SECRET"), events: ["missing.created"] }] });
