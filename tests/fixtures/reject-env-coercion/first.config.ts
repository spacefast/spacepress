import { collection, id, text, defineConfig, env, table } from "first";
const notes = table({ id: id(), secret: text().access({ read: Boolean(env("ALLOW_READ")) }) });
export default defineConfig({ tables: { notes } });
