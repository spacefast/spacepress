import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, userProjection } from "first";
const notes = userProjection({ email: email().unique().max(191) }, { drafts: true });
export default defineConfig({ users: { notes },  });
