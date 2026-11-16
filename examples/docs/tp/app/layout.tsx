import { Link, type LayoutProps } from "typedpress/app";
import "./site.css";

// Draws its own header and footer: the blank block template, so the theme's parts don't double them
// (docs/pages.md "Block templates").
export const template = "blank";

export const metadata = { title: { default: "TypedPress docs", template: "%s · TypedPress docs" }, description: "A documentation site on TypedPress." };

export default function Root({ children }: LayoutProps) {
  return (
    <div className="site">
      <header className="masthead">
        <Link href="/">TypedPress docs</Link>
        <nav><Link href="/docs/introduction">Docs</Link> <Link href="/about">About</Link></nav>
      </header>
      {children}
    </div>
  );
}
