import type { LayoutProps } from "spacepress/server/app";

// A route group's root layout: nothing above it but app/layout.tsx's chrome-less root, so it is
// nested and renders. (A group layout that is the outermost one is a root, and under the theme's
// header and footer doesn't render: see tests/php/block_templates.php "group root".)
export default function Shop({ children }: LayoutProps) {
  return <div className="shop-chrome"><p className="shop-banner">Shop banner</p>{children}</div>;
}
