import type { LayoutProps } from "spacepress/server/app";

// Draws its own header and footer: the blank block template, so the theme's parts don't double them
// (docs/pages.md "Block templates").
export const template = "blank";

export const metadata = { title: { default: "Docs", template: "%s · Docs" } };

export default function Root({ children }: LayoutProps) {
  return <div className="site">{children}</div>;
}
