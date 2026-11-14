import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, userProjection } from "first";
export const a = userProjection({ email: email().unique().max(191) });
export const b = userProjection({ email: email().unique().max(191) });
export default defineConfig({});
