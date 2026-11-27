import { collection, defineConfig, env, table, f } from "spacepress";
export const notes = table({ secret: f.text().access({ read: Boolean(env("ALLOW_READ")) }).optional() });
export default defineConfig({});
