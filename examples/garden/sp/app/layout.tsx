import { Link, type LayoutProps } from "spacepress/server/app";
import "./site.css";

// Draws its own header and footer: the blank block template, so the theme's parts don't double them
// (docs/pages.md "Block templates").
export const template = "blank";

export const metadata = { title: { default: "Garden", template: "%s · Garden" }, description: "A small plant guide." };

export default function Root({ children }: LayoutProps) {
  return (
    <div className="site">
      <header className="masthead"><Link href="/">Garden</Link></header>
      <main>{children}</main>
    </div>
  );
}
