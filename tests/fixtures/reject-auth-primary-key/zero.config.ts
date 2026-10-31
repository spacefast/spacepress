import { collection, defineConfig, email, text } from "zero";
const members = collection("members", { handle: text().primaryKey(), email: email().notNull().unique().max(191) }, { auth: true });
export default defineConfig({ name: "app", schema: { members } });
