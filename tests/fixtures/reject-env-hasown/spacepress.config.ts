import { collection, defineConfig, env, table, f } from "spacepress";
export const notes = table({ secret: f.text().access({ read: Object.hasOwn(env("ALLOW_READ"), "x") }).optional() });
export default defineConfig({});
