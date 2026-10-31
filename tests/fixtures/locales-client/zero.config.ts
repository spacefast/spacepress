// Localized collections keyed by a number (id()) and by text: translation ids follow the key type.
import { collection, defineConfig, id, integer, text } from "zero";

const guides = collection("guides", { id: id(), title: text().notNull().localized(), price: integer().notNull() }, { editor: false });
const codes = collection("codes", { id: text().primaryKey(), label: text().localized(), rank: integer() }, { editor: false });

// A collection keyed `locales` must not collide with the generated `Locale` type.
const locales = collection("locales", { id: id(), name: text().notNull() }, { editor: false });

export const schema = { guides, codes, locales };
export default defineConfig({ name: "localesclient", schema, locales: { default: "en", all: ["en", "de"] } });
