import { collection, id, text, env, action, defineConfig } from "zero";
const notes = collection("notes", { id: id(), title: text().notNull() }, { editor: false });
// No webhooks: a signed action alone already relies on lane D's runtime.
export default defineConfig({ schema: { notes }, actions: { inbound: action({ input: {}, signature: { secret: env("HOOK_SECRET"), header: "x-signature", scheme: "hmac-sha256" }, handler: () => true }) } });
