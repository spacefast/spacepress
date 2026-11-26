import { Link, type LayoutProps } from "spacepress/server/app";

export const metadata = {
  title: { default: "Field Notes", template: "%s · Field Notes" },
  description: "Notes.",
};

// Under the theme's header and footer this chrome doesn't render; pages that leave the theme's
// template (studio/) get it.
export default function Root({ children }: LayoutProps) {
  return <div className="app-root"><nav className="app-nav"><Link href="/">Home</Link></nav>{children}</div>;
}
