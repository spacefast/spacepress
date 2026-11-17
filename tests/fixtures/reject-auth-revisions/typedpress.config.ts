import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, userProjection } from "typedpress";
export const notes = userProjection({ email: email().unique().max(191) }, { revisions: true });
export default defineConfig({});
