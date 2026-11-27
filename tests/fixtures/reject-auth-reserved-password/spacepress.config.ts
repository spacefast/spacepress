import { defineConfig, extend, f } from "spacepress";
export const notes = extend("users", { fields: { password: f.text().optional() } });
export default defineConfig({});
