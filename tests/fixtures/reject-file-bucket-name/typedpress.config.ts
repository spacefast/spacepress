import { defineConfig, file, files, table } from "typedpress";
export const decks = files({ accept: ["application/pdf"], maxBytes: 10 });
export const notes = table({ deck: file({ bucket: "decks" }).optional() });
export default defineConfig({ name: "bucket-name" });
