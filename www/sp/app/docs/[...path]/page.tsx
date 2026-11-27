import { DocPage } from "@spacepress/docs";
import { headings, notFound } from "spacepress/app";
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

export const metadata = async ({ params, db }: PageProps) => {
  const item = await db.docs.get({ path: params.path });
  return {
    title: item ? item.title : "Reference",
    description: item?.description ?? undefined,
  };
};

export default async function ReferencePage({ params, db }: PageProps) {
  const item = await db.docs.get({ path: params.path });
  if (!item) notFound();
  const tree = await db.docs.nav(item);
  const { prev, next } = await db.docs.pager(item);
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
    />
  );
}
