import { collection, text, defineConfig, env, table } from "typedpress";
export const notes = table({ secret: text().access({ read: env("ALLOW_READ") !== null }).optional() });
export default defineConfig({});
