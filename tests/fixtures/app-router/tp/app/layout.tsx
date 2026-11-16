import { Link, type LayoutProps } from "typedpress/app";

export const metadata = {
  title: { default: "Field Notes", template: "%s · Field Notes" },
  description: "Notes.",
  openGraph: { type: "article" },
  twitter: { card: "summary_large_image" },
  links: [{ rel: "describedby", href: "/llms.txt", type: "text/plain" }],
};

export default function Root({ children }: LayoutProps) {
  return (
    <div className="site">
      <nav><Link href="/">Home</Link> <Link href="/notes" prefetch>Notes</Link></nav>
      <main>{children}</main>
    </div>
  );
}
