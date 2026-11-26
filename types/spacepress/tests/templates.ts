// `export const template` and <TemplatePart> (docs/pages.md "Block templates").
import { TemplatePart, type Template } from "spacepress/server/app";

export const theme: Template = "theme";
export const blank: Template = "blank";
export const custom: Template = "landing";
// @ts-expect-error a template is a slug
export const wrong: Template = 3;

export const header = TemplatePart({ slug: "header", tagName: "header" });
// @ts-expect-error a part needs its slug
export const missing = TemplatePart({ tagName: "header" });
