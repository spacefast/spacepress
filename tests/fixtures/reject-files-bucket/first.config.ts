import { defineConfig, file, files, table } from "first";
const decks = files({ accept: ["application/pdf"], maxBytes: 10 });
export const notes = table({ deck: file(decks).optional() });
export default defineConfig({});
