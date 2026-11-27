import { defineConfig, extend } from "spacepress";
export const notes = extend("users", { access: { create: "self" } });
export default defineConfig({});
