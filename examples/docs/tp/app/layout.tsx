import { Link, type LayoutProps } from "typedpress/app";
import "./site.css";

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
