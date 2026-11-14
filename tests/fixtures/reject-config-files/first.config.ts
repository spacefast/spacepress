import { defineConfig, files } from "first";
const decks = files({ accept: ["application/pdf"], maxBytes: 10 });
export default defineConfig({ files: { decks } });
