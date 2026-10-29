import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db } from "zero";
const notes = collection("notes", { id: id(), x: text() }, { editor: false });
export default defineConfig({ schema: { notes }, actions: { bad: action({ input: {}, access: "anyone", signature: { secret: env("SECRET"), header: "x-signature", scheme: "zero" }, handler: () => true }) } });
