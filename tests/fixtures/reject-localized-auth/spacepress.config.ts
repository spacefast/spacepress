import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, userProjection } from "spacepress";
export const notes = userProjection({ email: email().unique().max(191), name: text().localized().optional() });
export default defineConfig({ locales: { default: "en", all: ["en"] } });
