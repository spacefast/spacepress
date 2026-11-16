import { collection, text, defineConfig, env, table } from "typedpress";
export const notes = table({ secret: text().access({ read: env("ALLOW_READ") ? true : false }).optional() });
export default defineConfig({});
