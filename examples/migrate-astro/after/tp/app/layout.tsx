// Was src/layouts/Base.astro: the page's <html>, <head> and <body> are WordPress's now, so the
// layout keeps the header, main and footer; `title` and `description` became `metadata`.
import { Link, type LayoutProps } from "typedpress/app";

// Draws its own header and footer: the blank block template, so the theme's parts don't double them
// (docs/pages.md "Block templates").
export const template = "blank";

export const metadata = { title: { default: "Journal", template: "%s · Journal" } };

export default function Base({ children }: LayoutProps) {
  return (
    <>
      <header><Link href="/">Journal</Link> <Link href="/blog">Blog</Link> <Link href="/about">About</Link></header>
      <main>{children}</main>
      <footer>Written in the open.</footer>
    </>
  );
}
