import { collection, defineConfig, env, table, f } from "spacepress";
export const notes = table({ secret: f.text().access({ read: env("ALLOW_READ") !== null }).optional() });
export default defineConfig({});
