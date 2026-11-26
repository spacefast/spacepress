import "./site.css";
import type { LayoutProps } from "spacepress/server/app";

// Draws its own header and footer: the blank block template, so the theme's parts don't double them
// (docs/pages.md "Block templates").
export const template = "blank";

export const metadata = { title: { default: "Field Notes", template: "%s · Field Notes" } };

export default function Root({ children }: LayoutProps) {
  return <div className="site"><header>Field Notes</header><main>{children}</main></div>;
}
