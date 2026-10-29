import { collection, id, text, defineConfig, env } from "zero";
const notes = collection("notes", { id: id(), secret: text().access({ read: [true].some(() => env("ALLOW_READ")) }) }, { editor: false });
export default defineConfig({ schema: { notes } });
