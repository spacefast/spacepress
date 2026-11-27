import { defineConfig, extend, f } from "spacepress";
export const notes = extend("users", { fields: { email: f.text().optional() } });
export default defineConfig({});
