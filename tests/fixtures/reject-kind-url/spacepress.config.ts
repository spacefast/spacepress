import { collection, defineConfig, f } from "spacepress";
export const notes = collection({ title: f.text() });
export default defineConfig({ name: "kindurl", permalinks: { notes: "/notes/:titel" } });
