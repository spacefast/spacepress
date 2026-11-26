import type { LayoutProps } from "spacepress/app";
import "./site.css";

// Draws its own header and footer: the blank block template, so the theme's parts don't double them
// (docs/pages.md "Block templates").
export const template = "blank";

export const metadata = { title: { default: "Assets", template: "%s · Assets" } };

export default function Root({ children }: LayoutProps) {
  return <div className="site">{children}</div>;
}
