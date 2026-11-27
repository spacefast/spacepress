import { defineConfig, extend } from "spacepress";
export const notes = extend("users", { sync: "members/*.json" });
export default defineConfig({});
