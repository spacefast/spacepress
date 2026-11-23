import { collection, defineConfig, text } from "spacepress";
export const notes = collection({ title: text() }, { url: "/notes/:titel" });
export default defineConfig({ name: "kindurl" });
