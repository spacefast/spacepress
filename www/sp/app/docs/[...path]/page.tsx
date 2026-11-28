import { DocPage, ThemeToggle } from "@spacepress/docs";
import { docs } from "spacepress/server/db";
import { headings, nav, pager } from "spacepress/content";
import { docSources } from "../../../data/doc-sources";
import type { PageProps } from "./$types";

const site = {
  title: "SpacePress",
  url: "https://spacepress.dev",
  github: "spacefast/spacepress",
  editPath: "main/www/content/docs",
  resources: [
    { title: "Agent build playbook", href: "/start.md" },
    { title: "Compiler rules", href: "/rules.md" },
    { title: "Full site index", href: "/llms.txt" },
  ],
};

export const metadata = ({ item }: PageProps) => ({
  title: item.title,
  description: item.description ?? undefined,
});

export default async function ReferencePage({ item, params }: PageProps) {
  const tree = await nav(docs, item);
  const { prev, next } = await pager(docs, item);
  const path = params.path.join("/");

  return (
    <DocPage
      item={{ title: item.title, description: item.description, content: item.content, updatedAt: item.updatedAt }}
      tree={tree}
      prev={prev}
      next={next}
      headings={headings(item)}
      markdown={`/md/docs/${path}.md`}
      site={site}
      source={docSources[path]}
      home={{ title: "Reference", href: "/docs" }}
      headerAction={<ThemeToggle />}
    />
  );
}
