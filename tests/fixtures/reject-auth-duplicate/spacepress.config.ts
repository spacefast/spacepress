import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, userProjection } from "spacepress";
export const a = userProjection({ email: email().unique().max(191) });
export const b = userProjection({ email: email().unique().max(191) });
export default defineConfig({});
