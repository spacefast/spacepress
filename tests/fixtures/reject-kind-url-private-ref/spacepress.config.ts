import { collection, defineConfig, f } from "spacepress";
export const clients = collection({ title: f.text() }, { access: { read: "admin" } });
export const cases = collection({ title: f.text(), clientId: f.ref(clients) }, { url: "/cases/:clientId.slug/:slug" });
export default defineConfig({ name: "kindurlref" });
