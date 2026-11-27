import { Content, Link, notFound } from "spacepress/app";
import type { PageProps } from "./$types";

export const metadata = async ({ params, db }: PageProps) => {
  const item = await db.plants.get({ slug: params.slug });
  return { title: item ? item.title : "Plant not found", description: item?.summary ?? undefined };
};

export default async function Plant({ params, db }: PageProps) {
  const item = await db.plants.get({ slug: params.slug });
  if (!item) notFound();
  return (
    <article className="plant">
      <p className="back"><Link href="/">← All plants</Link></p>
      <h1>{item.title}</h1>
      <p className="meta">{item.family}{item.height !== null && ` · up to ${item.height} cm`}</p>
      <Content value={item.body} />
    </article>
  );
}
