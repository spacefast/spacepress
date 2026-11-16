import { collection, text, defineConfig, env, table } from "typedpress";
export const notes = table({ secret: text().access({ read: Boolean(env("ALLOW_READ")) }).optional() });
export default defineConfig({});
