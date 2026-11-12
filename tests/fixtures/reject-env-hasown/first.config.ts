import { collection, text, defineConfig, env, table } from "first";
const notes = table({ secret: text().access({ read: Object.hasOwn(env("ALLOW_READ"), "x") }).optional() });
export default defineConfig({ tables: { notes } });
