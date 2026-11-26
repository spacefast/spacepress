import { group, text, type FieldUi } from "spacepress";

/** A fresh immutable field set on each call; composition runs in SpacePress's pure evaluator. */
export function seoFields() {
  const titleUi: FieldUi = { label: "Search title", help: "Keep it concise.", width: 50 };
  return {
    seo: group({
      title: text().max(70).ui(titleUi).optional(),
      description: text({ multiline: true }).max(160).ui({ label: "Search description", width: 50 }).optional(),
    }).ui({ label: "Search preview" }).optional(),
  };
}
