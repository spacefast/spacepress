// Localized collections keyed by a number (id()) and by text: translation ids follow the key type.
import { collection, defineConfig, id, integer, text, table } from "first";

const guides = table({ id: id(), title: text().notNull().localized(), price: integer().notNull() });
const codes = table({ id: text().primaryKey(), label: text().localized(), rank: integer() });

// A collection keyed `locales` must not collide with the generated `Locale` type.
const locales = table({ id: id(), name: text().notNull() });

export const collections = {  };
export const tables = { guides, codes, locales };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };
export default defineConfig({ name: "localesclient", collections, tables, users, locales: { default: "en", all: ["en", "de"] } });
