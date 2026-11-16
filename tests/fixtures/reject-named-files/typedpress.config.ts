import { defineConfig, files } from "typedpress";
export const decks = files("decks", { accept: ["application/pdf"], maxBytes: 10 });
export default defineConfig({ name: "named-files" });
