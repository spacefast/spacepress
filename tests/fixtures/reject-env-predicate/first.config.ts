import { collection, text, defineConfig, env, table } from "first";
const notes = table({ secret: text().access({ read: [true].some(() => env("ALLOW_READ")) }).optional() });
export default defineConfig({ tables: { notes } });
