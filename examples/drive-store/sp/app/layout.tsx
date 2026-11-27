import { Link, type LayoutProps } from "spacepress/app";
import { home_url, is_user_logged_in, wp_login_url } from "spacepress/server/wp";
import "./site.css";

// Draws its own header and footer: the blank block template, so the theme's parts don't double them
// (docs/pages.md "Block templates").
export const template = "blank";

export const metadata = {
  title: { default: "Drive Store", template: "%s · Drive Store" },
  description: "Used hard drives and SSDs, tested and graded.",
  scripts: ["/drive-cart.js"],
  links: [{ rel: "alternate", type: "application/rss+xml", href: "/?feed=rss2&post_type=product" }],
};

export default async function RootLayout({ children, db }: LayoutProps) {
  const shop = await db.settings.get();
  const signedIn = is_user_logged_in();
  return (
    <div className="shell">
      <header className="top">
        <Link href="/" className="brand" prefetch><span className="platter" aria-hidden="true"></span>Drive Store</Link>
        <nav className="nav">
          <Link href="/" prefetch>Catalog</Link>
          <a href="/cart">Cart</a>
          <Link href="/staff" prefetch>Staff</Link>
          <a href={home_url("/source/")}>Source</a>
          <a href="/?feed=rss2&post_type=product">RSS</a>
        </nav>
        <p className="who">{signedIn ? <a href="/wp-login.php?action=logout">Sign out</a> : <a href={wp_login_url("")}>Sign in</a>}</p>
      </header>
      {shop.notice ? <p className="notice">{shop.notice}</p> : null}
      <main className="main">{children}</main>
      <footer className="foot">
        <p>Powered by WooCommerce. Staff can manage this store in <a href="/wp-admin/new/">SpacePress Admin</a>.</p>
      </footer>
    </div>
  );
}
