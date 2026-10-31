import { collection, defineConfig, global, id, text } from "zero";

const notes = collection("notes", { id: id(), body: text() }, { editor: false });

export default defineConfig({
  schema: { notes },
  globals: { settings: global("settings", { secret: text().access({ read: "editor" }) }) },
});
