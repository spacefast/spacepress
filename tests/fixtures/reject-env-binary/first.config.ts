import { collection, id, text, defineConfig, env, table } from "first";
const notes = table({ id: id(), secret: text().access({ read: env("ALLOW_READ") !== null }) });
export default defineConfig({ tables: { notes } });
