import { db } from "spacepress";
import { get_current_user_id, get_userdata, home_url, is_user_logged_in, wp_login_url } from "php/wordpress";
import { Link, type LayoutProps } from "spacepress/app";
import "./todo.css";

export const template = "blank";

export const metadata = {
  title: { default: "Personal TODO", template: "%s · Personal TODO" },
  description: "GTD + PARA personal task workspace powered by @spacepress/todo and SpacePress.",
};

export default async function RootLayout({ children }: LayoutProps) {
  const settings = await db.globals.settings.get();
  const signedIn = is_user_logged_in();
  const account = signedIn ? get_userdata(get_current_user_id()) : false;

  return (
    <div className="sp-shell">
      <header className="sp-topbar">
        <div className="sp-topbar__brand">
          <Link href="/" className="sp-topbar__brand">
            <span className="sp-topbar__mark" aria-hidden="true">✓</span>
            <span>{settings.workspaceName}</span>
          </Link>
          <span className="sp-topbar__tagline">{settings.tagline}</span>
        </div>
        <nav className="sp-topbar__actions" aria-label="Workspace utilities">
          <Link href="/?view=inbox" className="sp-topbar__link sp-topbar__link--desktop">Inbox</Link>
          <Link href="/?view=now" className="sp-topbar__link sp-topbar__link--desktop">Now</Link>
          <Link href="/?view=scheduled" className="sp-topbar__link sp-topbar__link--desktop">Scheduled</Link>
          <a href="/wp-admin/new/" className="sp-topbar__link">Admin</a>
          {account !== false ? (
            <span className="sp-topbar__link">{account.display_name}</span>
          ) : (
            <a href={wp_login_url(home_url("/"))} className="sp-topbar__link">Sign in</a>
          )}
        </nav>
      </header>
      {children}
    </div>
  );
}
