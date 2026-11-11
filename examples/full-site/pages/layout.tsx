import { link, type LayoutProps, type Metadata } from "@spacefast/first-pages";
import "../styles/global.css";

export const metadata = {
  title: { default: "Field Notes", template: "%s · Field Notes" },
  description: "Short notes from the field, written in WordPress and served by First pages.",
} satisfies Metadata;

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="site">
      <header className="site-header">
        <p className="site-title"><a href={link("/")}>Field Notes</a></p>
        <nav className="site-nav">
          <p>
            <a href={link("/notes")}>Notes</a> · <a href={link("/notes/featured")}>Featured</a> · <a href={link("/about")}>About</a>
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
