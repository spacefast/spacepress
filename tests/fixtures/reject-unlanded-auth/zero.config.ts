import { collection, id, text, email, defineConfig } from "zero";
const members = collection("members", { id: id(), email: email().notNull().unique().max(191), name: text() }, { editor: false, auth: true });
export default defineConfig({ schema: { members } });
