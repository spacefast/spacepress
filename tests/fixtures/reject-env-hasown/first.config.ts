import { collection, id, text, defineConfig, env, table } from "first";
const notes = table({ id: id(), secret: text().access({ read: Object.hasOwn(env("ALLOW_READ"), "x") }) });
export default defineConfig({ tables: { notes } });
