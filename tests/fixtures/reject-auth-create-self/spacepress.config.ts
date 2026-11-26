import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, env, global, defineConfig, userProjection } from "spacepress";
import { once, db } from "spacepress/server";
export const notes = userProjection({ email: email().unique().max(191) }, { access: { create: "self" } });
export default defineConfig({});
