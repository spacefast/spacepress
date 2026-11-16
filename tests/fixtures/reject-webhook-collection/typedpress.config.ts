import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "typedpress";
export const notes = table({ x: text().optional() });
export default defineConfig({ webhooks: [{ url: env("HOOK_URL"), secret: env("SECRET"), events: ["missing.created"] }] });
