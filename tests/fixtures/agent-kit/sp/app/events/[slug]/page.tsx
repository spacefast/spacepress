import { db } from "spacepress";
import { notFound, type PageProps } from "spacepress/app";

export default async function Event({ params }: PageProps<"events/[slug]">) {
  const event = await db.query.cookingEvents.findFirst({ where: { slug: params.slug } });
  if (!event) notFound();
  return <h1>{event.title}</h1>;
}
