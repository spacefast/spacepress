import { db } from "spacepress/server";
import { Content, Link, notFound, type PageProps } from "spacepress/app";

export const metadata = async ({ params }: PageProps<"[...path]">) => {
  const item = await db.docs.get({ path: params.path });
  return { title: item?.title ?? "Not found" };
};

export default async function Doc({ params }: PageProps<"[...path]">) {
  const item = await db.docs.get({ path: params.path });
  if (!item) notFound();
  const tree = await db.docs.nav(item);
  const { next } = await db.docs.pager(item);
  return (
    <article>
      <h1>{item.title}</h1>
      <ul className="tree">{tree.map((a) => <li key={a.id}><Link href={a.href}>{a.title}</Link></li>)}</ul>
      <Content value={item.content} />
      {next && <Link href={next.href} rel="next">{next.title}</Link>}
    </article>
  );
}
