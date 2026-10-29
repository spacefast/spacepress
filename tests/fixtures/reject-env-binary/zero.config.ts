import { collection, id, text, defineConfig, env } from "zero";
const notes = collection("notes", { id: id(), secret: text().access({ read: env("ALLOW_READ") !== null }) }, { editor: false });
export default defineConfig({ schema: { notes } });
