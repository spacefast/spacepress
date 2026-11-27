import { DocsEnhancements } from "@spacepress/docs";
import type { LayoutProps } from "spacepress/app";

export default function ReferenceLayout({ children }: LayoutProps) {
  return (
    <section className="sp-reference" aria-label="SpacePress reference">
      {children}
      <DocsEnhancements copyCode={false} />
    </section>
  );
}
