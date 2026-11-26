import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, env, global, defineConfig, userProjection } from "spacepress";
import { once, db } from "spacepress/server";
export const a = userProjection({ email: email().unique().max(191) });
export const b = userProjection({ email: email().unique().max(191) });
export default defineConfig({});
