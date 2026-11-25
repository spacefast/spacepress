import { Link, type LayoutProps } from "spacepress/app";

export const template = "blank";

export const metadata = {
  title: { default: "Editorial", template: "%s · Editorial" },
  description: "Server-rendered TSX pages backed by WordPress.",
};

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="shell">
      <header>
        <Link href="/">Editorial</Link>
      </header>
      <main>{children}</main>
    </div>
  );
}
