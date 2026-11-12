// Localized tables: translation ids are the integer `id` every kind has.
import { defineConfig, integer, text, table } from "first";

const guides = table({ title: text().localized(), price: integer() });
const codes = table({ code: text().unique().max(191), label: text().localized().optional(), rank: integer().optional() });

// A kind named `locales` must not collide with the generated `Locale` type.
const locales = table({ name: text() });

export const tables = { guides, codes, locales };
export default defineConfig({ name: "localesclient", tables, locales: { default: "en", all: ["en", "de"] } });
