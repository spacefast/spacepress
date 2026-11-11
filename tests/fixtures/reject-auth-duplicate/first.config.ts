import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, userProjection } from "first";
const a = userProjection({ id: id(), email: email().notNull().unique().max(191) });
const b = userProjection({ id: id(), email: email().notNull().unique().max(191) });
export default defineConfig({ users: { a, b } });
