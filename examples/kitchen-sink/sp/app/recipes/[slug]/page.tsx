import { Comments, Content, notFound } from "spacepress/app";
import type { PageProps } from "./$types";

export const metadata = async ({ params, db }: PageProps) => {
  const item = await db.recipes.get({ slug: params.slug });
  return { title: item?.title ?? "Recipe", description: item?.excerpt ?? "" };
};

export default async function Recipe({ params, db }: PageProps) {
  const item = await db.recipes.get({ slug: params.slug });
  if (!item) notFound();
  return (
    <article>
      <h1>{item.title}</h1>
      <p>Serves {item.servings}</p>
      {/* The kitchen-policy plugin's beforeCreate hook wrote this notice when the recipe was created. */}
      {item.excerpt && <p role="note">{item.excerpt}</p>}
      <Content value={item.content} />
      <Comments for={item} />
    </article>
  );
}
