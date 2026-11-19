import { db } from "typedpress";
import { Link, TemplatePart, type LayoutProps } from "typedpress/app";
import "./site.css";

export const template = "blank";
export const metadata = { title: { default: "Community Kitchen", template: "%s · Community Kitchen" } };

export default async function Layout({ children }: LayoutProps) {
  const kitchen = await db.globals.settings.get();
  return (
    <>
      <TemplatePart slug="header" tagName="header" />
      <main className="kitchen">
        <nav aria-label="Kitchen">
          <Link href="/" prefetch>{kitchen.siteTitle}</Link>
          <Link href="/handbook">Handbook</Link>
          <Link href="/visits/saturday">Visiting</Link>
          <Link href="/shop">Supplies</Link>
          <Link href="/staff">Staff</Link>
        </nav>
        {kitchen.announcement && <p>{kitchen.announcement}</p>}
        {children}
      </main>
      <TemplatePart slug="footer" tagName="footer" />
    </>
  );
}
