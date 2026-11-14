import { collection, defineConfig, global, text, table } from "first";

const notes = table({ body: text().optional() });

export default defineConfig({
  tables: { notes },
  globals: { settings: global({ secret: text().access({ read: "editor" }).optional() }) },
});
