import { collection, defineConfig, integer, text } from "first";
export const clients = collection({ title: text().notNull() }, { access: { read: "admin" } });
export const cases = collection({ title: text().notNull(), clientId: integer().notNull().references(() => clients.id) }, { url: "/cases/:clientId.slug/:slug" });
export default defineConfig({ name: "kindurlref", collections: { clients, cases } });
