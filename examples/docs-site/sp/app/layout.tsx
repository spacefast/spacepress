import { docs } from "spacepress/server/db";
import type { LayoutProps } from "spacepress/app";
import { nav } from "spacepress/content";
import { DocsShell, searchEntries } from "@spacepress/docs";

export const template = "blank";

export const metadata = {
  title: { default: "Acme Docs", template: "%s · Acme Docs" },
  description: "A documentation site built on SpacePress with @spacepress/docs.",
  scripts: ["/theme.js"],
};

export default async function Root({ children }: LayoutProps) {
  return (
    <DocsShell
      title="Acme Docs"
      mark="A"
      github="spacefast/spacepress"
      links={[
        { label: "Docs", href: "/docs/introduction" },
        { label: "Components", href: "/docs/components" },
      ]}
      search={searchEntries(await nav(docs))}
      footer={<span>Built with SpacePress and @spacepress/docs.</span>}
    >
      {children}
    </DocsShell>
  );
}
