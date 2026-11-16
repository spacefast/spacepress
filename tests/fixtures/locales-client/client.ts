// Generated client types for localized collections (§7.3).
import type { Code, CodeInsert, Guide, GuideInsert, GuidePatch, Locale, LocaleRow } from "./tp/_generated/client/types";
import { db } from "typedpress";

async function registryTranslations() {
  for (const row of await db.query.guides.findMany()) {
    const translations: Partial<Record<"en" | "de", number>> = row.translations;
    void translations;
  }
  for (const row of await db.query.codes.findMany()) {
    const translations: Partial<Record<"en" | "de", number>> = row.translations;
    void translations;
  }
}
void registryTranslations;

const locale: Locale = "de";
// @ts-expect-error a locale outside the config
const other: Locale = "fr";
declare const guide: Guide;
declare const code: Code;
const guideIds: Partial<Record<"en" | "de", number>> = guide.translations;
const codeIds: Partial<Record<"en" | "de", number>> = code.translations;
// @ts-expect-error translation ids are row ids, not text keys
const wrongIds: Partial<Record<"en" | "de", string>> = code.translations;
// A translation copies synced columns (price), so it may omit them; a fresh row may not.
const translation: GuideInsert = { title: "Tee", locale: "de", translationOf: 1 };
// @ts-expect-error a fresh row needs its required synced column
const fresh: GuideInsert = { title: "Tea" };
const codeTranslation: CodeInsert = { code: "01-de", locale: "de", translationOf: 1 };
// @ts-expect-error a translation names its source by row id
const numericOf: CodeInsert = { code: "01-de", locale: "de", translationOf: "01" };
// @ts-expect-error locale is fixed per row
const moved: GuidePatch = { locale: "de" };
// @ts-expect-error the group id is hidden
guide.translationGroup;
const localeRow: LocaleRow = { id: 1, name: "German" };
void [localeRow, locale, other, guideIds, codeIds, wrongIds, translation, fresh, codeTranslation, numericOf, moved];
