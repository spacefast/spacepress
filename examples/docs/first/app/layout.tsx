import { Link, type LayoutProps } from "first/app";
import "./site.css";

export const metadata = { title: { default: "First docs", template: "%s · First docs" }, description: "A documentation site on First." };

export default function Root({ children }: LayoutProps) {
  return (
    <div className="site">
      <header className="masthead">
        <Link href="/">First docs</Link>
        <nav><Link href="/docs/introduction">Docs</Link> <Link href="/about">About</Link></nav>
      </header>
      {children}
    </div>
  );
}
