import { collection, id, text, defineConfig, env } from "zero";
const notes = collection("notes", { id: id(), secret: text().access({ read: Object.hasOwn(env("ALLOW_READ"), "x") }) }, { editor: false });
export default defineConfig({ schema: { notes } });
