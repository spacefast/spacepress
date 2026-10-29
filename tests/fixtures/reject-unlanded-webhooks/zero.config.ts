import { collection, id, text, env, defineConfig } from "zero";
const notes = collection("notes", { id: id(), title: text().notNull() }, { editor: false });
export default defineConfig({ schema: { notes }, webhooks: [{ url: "https://example.com/hook", secret: env("HOOK_SECRET"), events: ["notes.created"] }] });
