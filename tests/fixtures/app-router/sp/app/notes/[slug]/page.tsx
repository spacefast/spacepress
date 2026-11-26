import { db } from "spacepress/server";
import { notFound, type PageProps, type RouteRequest } from "spacepress/app";

export const metadata = ({ params }: PageProps<"notes/[slug]">) => ({
  title: `Note ${params.slug}`,
  canonical: `/notes/${params.slug}`,
  openGraph: { image: `/og/${params.slug}.png` },
  // The layout's link again, its keys in another order: the head still has it once.
  links: [
    { rel: "alternate", href: `/notes/${params.slug}.md`, type: "text/markdown" },
    { type: "text/plain", href: "/llms.txt", rel: "describedby" },
  ],
  scripts: ["/note.js", "https://cdn.example/a.js"],
});

export default async function Note({ params }: PageProps<"notes/[slug]">) {
  const note = await db.query.notes.findFirst({ where: { slug: params.slug } });
  if (!note) notFound();
  return (
    <article>
      <h1>{note.title}</h1>
      {note.secret && <aside className="secret">{note.secret}</aside>}
    </article>
  );
}

// The page's own form handler: POST to the page URL, for signed-in readers.
export const guard = { page: undefined, handlers: "subscriber" };

export async function POST(req: RouteRequest) {
  return { status: 303, headers: { location: `/notes/${req.params.slug}?sent=1` }, body: "" };
}
