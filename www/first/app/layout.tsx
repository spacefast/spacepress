// The one layout: the guide, the playground, every doc and every blog post render inside it.
import type { LayoutProps } from "first/app";
import "./site.css";

export const metadata = {
  title: { default: "TypedPress", template: "%s · TypedPress" },
  description: "Describe your data and pages in TypeScript. TypedPress compiles them into a WordPress plugin.",
};

export default function Root({ children }: LayoutProps) {
  return (
    <div className="site">
      <header className="top">
        <a className="brand" href="/">TypedPress</a>
        <nav aria-label="Site">
          <a href="/">Guide</a>
          <a href="/examples">Examples</a>
          <a href="/docs">Docs</a>
          <a href="/blog">Blog</a>
          <a className="play" href="/play">Playground</a>
        </nav>
      </header>
      {children}
      <footer className="foot">
        TypedPress, formerly First. This site is a TypedPress app: its pages are TSX, its docs and posts are WordPress content, and WordPress serves it.
        Code, file trees and diffs are drawn with <a href="https://diffs.com">@pierre/diffs</a> and @pierre/trees (Apache-2.0, <a href="/third-party-licenses.txt">licences</a>).
      </footer>
    </div>
  );
}
