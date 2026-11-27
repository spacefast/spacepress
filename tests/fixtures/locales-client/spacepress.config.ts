// Localized tables: translation ids are the integer `id` every kind has.
import { defineConfig, table, f } from "spacepress";

export const guides = table({ title: f.text().localized(), price: f.integer() });
export const codes = table({ code: f.text().unique().max(191), label: f.text().localized().optional(), rank: f.integer().optional() });

// A kind named `locales` must not collide with the generated `Locale` type.
export const locales = table({ name: f.text() });

export const tables = { guides, codes, locales };
export default defineConfig({ name: "localesclient", locales: { default: "en", all: ["en", "de"] } });
