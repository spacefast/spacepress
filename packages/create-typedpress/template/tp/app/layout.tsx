import { db } from "typedpress";
import { Link, type LayoutProps } from "typedpress/app";
import "./site.css";

// Use a blank WordPress block template so this layout owns the header and footer.
export const template = "blank";
// The browser title follows the site name an editor sets in Site settings, as the header does.
export const metadata = async () => {
  const site = await db.globals.site.get();
  return { title: { default: site.name, template: `%s · ${site.name}` } };
};

export default async function Layout({ children }: LayoutProps) {
  const site = await db.globals.site.get();
  return (
    <div className="site">
      <header className="masthead">
        <Link className="brand" href="/">{site.name}</Link>
        <nav aria-label="Site">
          <Link href="/notes">Notes</Link>
          <Link href="/account">Account</Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer>Built with <a href="https://spacepress.dev">SpacePress</a></footer>
    </div>
  );
}
