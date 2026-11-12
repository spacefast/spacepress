import { collection, defineConfig, ref, text } from "first";
export const clients = collection({ title: text() }, { access: { read: "admin" } });
export const cases = collection({ title: text(), clientId: ref(clients) }, { url: "/cases/:clientId.slug/:slug" });
export default defineConfig({ name: "kindurlref", collections: { clients, cases } });
