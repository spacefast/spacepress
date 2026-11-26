import { docs } from "spacepress/server/db";
import type { PageProps } from "./$types";
import { headings, nav, pager } from "spacepress/content";
import { DocPage } from "@spacepress/docs";

export const metadata = ({ item }: PageProps) => ({
  title: item.title,
  description: item.description ?? undefined,
});

export default async function Doc({ item, params }: PageProps) {
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
      markdown={`/docs/${path}.md`}
      site={{ title: "Acme Docs", github: "spacefast/spacepress", editPath: "main/examples/docs-site/content/docs" }}
      source={path === "guides" ? "guides/index.md" : `${path}.md`}
    />
  );
}
