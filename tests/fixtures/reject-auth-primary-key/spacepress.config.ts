import { defineConfig, email, text, userProjection } from "spacepress";
export const members = userProjection({ handle: text().primaryKey(), email: email().unique().max(191) });
export default defineConfig({ name: "app" });
