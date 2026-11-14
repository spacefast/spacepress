import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, userProjection } from "first";
export const notes = userProjection({ email: email().unique().max(191), name: text().localized().optional() });
export default defineConfig({ locales: { default: "en", all: ["en"] } });
