import { defineConfig, files, table, f } from "spacepress";
export const decks = files({ accept: ["application/pdf"], maxBytes: 10 });
export const notes = table({ deck: f.file({ bucket: "decks" }).optional() });
export default defineConfig({ name: "bucket-name" });
