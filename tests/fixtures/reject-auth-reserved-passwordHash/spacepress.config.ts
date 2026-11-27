import { defineConfig, extend, f } from "spacepress";
export const notes = extend("users", { fields: { passwordHash: f.text().optional() } });
export default defineConfig({});
