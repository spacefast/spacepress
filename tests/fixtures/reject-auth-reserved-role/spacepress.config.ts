import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, userProjection } from "spacepress";
export const notes = userProjection({ email: email().unique().max(191), role: text().optional() });
export default defineConfig({});
