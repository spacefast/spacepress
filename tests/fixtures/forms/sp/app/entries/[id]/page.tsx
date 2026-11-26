import { db } from "spacepress";
import { notFound, type PageProps } from "spacepress/app";
import { remove } from "../../../server";

// One entry, with a form that deletes it and comes back here: then a 404.
export default async function Entry({ params }: PageProps<"entries/[id]">) {
  const entry = await db.query.entries.findFirst({ where: { id: Number(params.id) } });
  if (!entry) notFound();
  return (
    <main>
      <h1 className="entry-name">{entry.name}</h1>
      <form action={remove} className="remove">
        <input type="hidden" name="id" value={String(entry.id)} />
        <button>Delete</button>
      </form>
    </main>
  );
}
