import { Content, headings, Link, notFound } from "spacepress/app";
import type { PageProps } from "./$types";

export default async function Handbook({ params, db }: PageProps) {
  const item = await db.handbook.get({ path: params.path });
  if (!item) notFound();
  const chapters = await db.handbook.nav(item);
  const nearby = await db.handbook.pager(item);
  const previous = nearby.prev;
  const next = nearby.next;
  return (
    <article>
      <h1>{item.title}</h1>
      <ul>{chapters.map((chapter) => <li><a href={chapter.href}>{chapter.title}</a></li>)}</ul>
      <ul>{headings(item).map((heading) => <li><Link href={`#${heading.id}`}>{heading.text}</Link></li>)}</ul>
      <Content value={item.content} />
      {previous && <a href={previous.href}>Previous: {previous.title}</a>}
      {next && <a href={next.href}>Next: {next.title}</a>}
    </article>
  );
}
