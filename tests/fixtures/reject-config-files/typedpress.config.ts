import { defineConfig, files } from "typedpress";
const decks = files({ accept: ["application/pdf"], maxBytes: 10 });
export default defineConfig({ files: { decks } });
