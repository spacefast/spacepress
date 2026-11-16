import { Link, type LayoutProps } from "typedpress/app";
import "./global.css";

export const metadata = {
  title: { default: "Field Notes", template: "%s · Field Notes" },
  description: "Short notes from the field, written in WordPress and rendered by TypedPress.",
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="site">
      <header className="site-header">
        <p className="site-title"><Link href="/">Field Notes</Link></p>
        <nav className="site-nav">
          <p>
            <Link href="/notes">Notes</Link> · <Link href="/notes/featured">Featured</Link> · <Link href="/applause">Applause</Link> · <Link href="/about">About</Link>
          </p>
        </nav>
      </header>
      <main className="site-main">{children}</main>
      <footer className="site-footer">
        <p>Rendered by WordPress from TSX. Edit notes in wp-admin; the pages follow.</p>
      </footer>
    </div>
  );
}
