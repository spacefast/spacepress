import { defineConfig, files } from "spacepress";
const decks = files({ accept: ["application/pdf"], maxBytes: 10 });
export default defineConfig({ files: { decks } });
