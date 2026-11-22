import { Content, Link, type PageProps } from "typedpress/app";
import { claps } from "typedpress:db";
import { ClapButton } from "../../../components/ClapButton";

export const metadata = ({ item }: PageProps<"articles/[slug]">) => ({
  title: item.title,
  description: item.summary ?? undefined,
});

export default async function ArticlePage({ item }: PageProps<"articles/[slug]">) {
  const row = await claps.get({ articleId: item.id });
  return (
    <article>
      <p><Link href="/">← All articles</Link></p>
      <h1>{item.title}</h1>
      <Content value={item.body} />
      <ClapButton articleId={item.id} initial={row?.count ?? 0} />
    </article>
  );
}
