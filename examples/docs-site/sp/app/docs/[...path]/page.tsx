import type { PageProps } from "./$types";
import { headings, notFound } from "spacepress/app";
import { DocPage } from "@spacepress/docs";

export const metadata = async ({ params, db }: PageProps) => {
  const item = await db.docs.get({ path: params.path });
  return {
    title: item ? item.title : "Doc not found",
    description: item?.description ?? undefined,
  };
};

export default async function Doc({ params, db }: PageProps) {
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
      markdown={`/docs/${path}.md`}
      site={{ title: "Acme Docs", github: "spacefast/spacepress", editPath: "main/examples/docs-site/content/docs" }}
      source={path === "guides" ? "guides/index.md" : `${path}.md`}
    />
  );
}
