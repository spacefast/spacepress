import { defineConfig, files } from "first";
export const decks = files("decks", { accept: ["application/pdf"], maxBytes: 10 });
export default defineConfig({ name: "named-files" });
