import { defineConfig, files, table, f } from "spacepress";
const decks = files({ accept: ["application/pdf"], maxBytes: 10 });
export const notes = table({ deck: f.file(decks).optional() });
export default defineConfig({});
