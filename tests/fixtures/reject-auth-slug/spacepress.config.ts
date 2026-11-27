import { defineConfig, extend, f } from "spacepress";
export const notes = extend("users", { fields: { handle: f.slug().optional() } });
export default defineConfig({});
