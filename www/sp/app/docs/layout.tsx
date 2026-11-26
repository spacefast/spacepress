import { DocsEnhancements, ThemeToggle } from "@spacepress/docs";
import type { LayoutProps } from "spacepress/app";

export default function ReferenceLayout({ children }: LayoutProps) {
  return (
    <section className="sp-reference" aria-label="SpacePress reference">
      <div className="sp-reference-toolbar">
        <ThemeToggle />
      </div>
      {children}
      <DocsEnhancements copyCode={false} />
    </section>
  );
}
