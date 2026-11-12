import { Link, type LayoutProps } from "first/app";

export const metadata = { title: { default: "Field Notes", template: "%s · Field Notes" }, description: "Notes." };

export default function Root({ children }: LayoutProps) {
  return (
    <div className="site">
      <nav><Link href="/">Home</Link> <Link href="/notes" prefetch>Notes</Link></nav>
      <main>{children}</main>
    </div>
  );
}
