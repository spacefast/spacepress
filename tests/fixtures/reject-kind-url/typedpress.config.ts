import { collection, defineConfig, text } from "typedpress";
export const notes = collection({ title: text() }, { url: "/notes/:titel" });
export default defineConfig({ name: "kindurl" });
