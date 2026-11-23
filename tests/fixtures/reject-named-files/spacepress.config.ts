import { defineConfig, files } from "spacepress";
export const decks = files("decks", { accept: ["application/pdf"], maxBytes: 10 });
export default defineConfig({ name: "named-files" });
