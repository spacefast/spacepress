// Tabs: each `Tab` is a panel. The server renders every panel with its title, so the page reads
// and prints without JavaScript; `DocsEnhancements` turns the titles into a tab strip and keeps the
// choice in `?<param>=` when `param` is set.
import type { ReactNode } from "spacepress/app";

export function Tabs({ param, children }: { param?: string; children?: ReactNode }) {
  return (
    <div className="sd-tabs" data-sd-tabs="" data-sd-param={param ?? ""}>
      {children}
    </div>
  );
}

export function Tab({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="sd-tab-panel" data-sd-tab-title={title}>
      <p className="sd-tab-label">{title}</p>
      {children}
    </section>
  );
}
