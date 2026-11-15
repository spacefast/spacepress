// Storefront reads, shared by the pages. Reads run as the visitor, so a drive an editor hasn't
// published never shows. A localized kind reads in the locale asked for, and falls back to the
// English row of a drive nobody has translated yet.
import { drives } from "first:db";

export type Lang = "en" | "tr";

/** The storefront's language: `?language=tr` on any page, English otherwise. */
export function pickLang(value: string | null | undefined): Lang {
  return value === "tr" ? "tr" : "en";
}

/** A storefront path in that language. */
export function inLang(path: string, lang: Lang): string {
  return lang === "en" ? path : `${path}?language=${lang}`;
}

export async function catalog(lang: Lang, q: string, media: string, condition: string) {
  const rows = q
    ? await drives.list({ locale: lang, where: { status: "published" }, search: q, orderBy: { price: "asc" }, limit: 100 })
    : await drives.list({ locale: lang, where: { status: "published" }, orderBy: { price: "asc" }, limit: 100 });
  // Each drive has one page, at its English slug; a translation's own slug isn't an address yet.
  const english = lang === "en" ? rows : await drives.list({ locale: "en", where: { status: "published" }, limit: 100 });
  // `where` takes one value per field, so the optional filters apply here.
  return rows
    .filter((d) => (media === "" || d.media === media) && (condition === "" || d.condition === condition))
    .map((d) => {
      const id = d.translations.en ?? d.id;
      const slug = english.find((e) => e.id === id)?.slug ?? "";
      return { ...d, href: inLang(`/drives/${slug}`, lang) };
    });
}
