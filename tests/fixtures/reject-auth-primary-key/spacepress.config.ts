import { defineConfig, extend, f } from "spacepress";
export const members = extend("users", { fields: { handle: f.text().primaryKey() } });
export default defineConfig({ name: "app" });
