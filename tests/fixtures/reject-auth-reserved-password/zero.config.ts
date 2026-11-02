import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, userProjection } from "zero";
const notes = userProjection({ id: id(), email: email().notNull().unique().max(191), password: text() });
export default defineConfig({ users: { notes },  });
