import { collection, defineConfig, text } from "first";
export const notes = collection({ title: text() }, { url: "/notes/:titel" });
export default defineConfig({ name: "kindurl", collections: { notes } });
