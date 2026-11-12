import { collection, defineConfig, text } from "first";
export const notes = collection({ title: text().notNull() }, { url: "/notes/:titel" });
export default defineConfig({ name: "kindurl", collections: { notes } });
