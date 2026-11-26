import { docs } from "spacepress:db";
import type { PageProps } from "spacepress/app";
import { headings, nav, pager } from "spacepress/content";
import { DocPage } from "@spacepress/docs";

export const metadata = ({ item }: PageProps<"docs/[...path]">) => ({
  title: item.title,
  description: item.description ?? undefined,
});

export default async function Doc({ item, params }: PageProps<"docs/[...path]">) {
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
      source={`${path}.md`}
    />
  );
}
