import { group, text, type FieldUi } from "first";

/** A fresh immutable field set on each call; composition runs in First's pure evaluator. */
export function seoFields() {
  const titleUi: FieldUi = { label: "Search title", help: "Keep it concise.", width: 50 };
  return {
    seo: group({ fields: {
      title: text().max(70).ui(titleUi),
      description: text({ multiline: true }).max(160).ui({ label: "Search description", width: 50 }),
    } }).ui({ label: "Search preview" }),
  };
}
