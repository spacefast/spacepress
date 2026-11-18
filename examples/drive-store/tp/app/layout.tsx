// Every storefront page sits in this layout. Anyone may browse and buy; "My orders" and "Staff"
// have guards of their own (tp/app/orders/layout.tsx and tp/app/staff/layout.tsx).
import { db } from "typedpress";
import { Link, type LayoutProps } from "typedpress/app";
import { home_url, is_user_logged_in, wp_login_url } from "php/wordpress";
import "./site.css";

// Draws its own header and footer: the blank block template, so the theme's parts don't double them
// (docs/pages.md "Block templates").
export const template = "blank";

export const metadata = {
  title: { default: "Drive Store", template: "%s · Drive Store" },
  description: "Used hard drives and SSDs, tested and graded. A TypedPress example shop: nothing here is for sale.",
  // WordPress's own RSS feed of the drives post type, for feed readers: new stock as it is published.
  links: [{ rel: "alternate", type: "application/rss+xml", href: "/?feed=rss2&post_type=tp_drives" }],
};

export default async function RootLayout({ children }: LayoutProps) {
  const shop = await db.globals.shop.get();
  const signedIn = is_user_logged_in();
  return (
    <div className="shell">
      <header className="top">
        <Link href="/" className="brand" prefetch><span className="platter" aria-hidden="true"></span>{shop.shopName}</Link>
        <nav className="nav">
          <Link href="/" prefetch>Catalog</Link>
          {signedIn ? <Link href="/orders" prefetch>My orders</Link> : <a href={wp_login_url(home_url("/orders/"))}>My orders</a>}
          {signedIn ? <Link href="/staff" prefetch>Staff</Link> : <a href={wp_login_url(home_url("/staff/"))}>Staff</a>}
          <a href="/?feed=rss2&post_type=tp_drives">RSS</a>
        </nav>
        <p className="who">{signedIn ? <a href="/wp-login.php?action=logout">Sign out</a> : <a href={wp_login_url("")}>Sign in</a>}</p>
      </header>
      {shop.notice ? <p className="notice">{shop.notice}</p> : null}
      <main className="main">{children}</main>
      <footer className="foot">
        <p>A demo shop built with TypedPress: no payment is taken and nothing ships. Staff manage drives, orders and settings in <a href="/wp-admin/new/">TypedPress Admin</a>.</p>
      </footer>
    </div>
  );
}
