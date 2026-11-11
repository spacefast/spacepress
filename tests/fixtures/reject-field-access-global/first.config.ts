import { collection, defineConfig, global, id, text, table } from "first";

const notes = table({ id: id(), body: text() });

export default defineConfig({
  tables: { notes },
  globals: { settings: global("settings", { secret: text().access({ read: "editor" }) }) },
});
