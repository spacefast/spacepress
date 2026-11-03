import { collection, defineConfig, email, text, userProjection } from "zero";
const members = userProjection({ handle: text().primaryKey(), email: email().notNull().unique().max(191) });
export default defineConfig({ name: "app", users: { members } });
