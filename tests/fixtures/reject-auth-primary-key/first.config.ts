import { defineConfig, email, text, userProjection } from "first";
export const members = userProjection({ handle: text().primaryKey(), email: email().unique().max(191) });
export default defineConfig({ name: "app" });
