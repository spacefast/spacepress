import { collection, id, text, defineConfig } from "zero";
const posts = collection("posts", { id: id(), title: text().notNull().localized() }, { editor: false });
export default defineConfig({ schema: { posts }, locales: { default: "en", all: ["en", "de"] } });
