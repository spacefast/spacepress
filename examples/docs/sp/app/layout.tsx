import { Link, type LayoutProps } from "spacepress/app";
import "./site.css";

// Draws its own header and footer: the blank block template, so the theme's parts don't double them
// (docs/pages.md "Block templates").
export const template = "blank";

export const metadata = { title: { default: "SpacePress docs", template: "%s · SpacePress docs" }, description: "A documentation site on SpacePress." };

export default function Root({ children }: LayoutProps) {
  return (
    <div className="site">
      <header className="masthead">
        <Link href="/">SpacePress docs</Link>
        <nav><Link href="/docs/introduction">Docs</Link> <Link href="/about">About</Link></nav>
      </header>
      {children}
    </div>
  );
}
