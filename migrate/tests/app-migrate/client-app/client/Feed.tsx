import { usePaginatedQuery } from "@spacefast/zero/client";

type Note = { id: string; title: string };

export function Feed({ shelf }: { shelf: string }) {
  const { page, isDone, loadMore } = usePaginatedQuery<Note>("page", { shelf }, { initialNumItems: 2 });
  return (
    <section>
      <ul>{page.map((n) => <li key={n.id}>{n.title}</li>)}</ul>
      {isDone ? null : <button onClick={loadMore}>More</button>}
    </section>
  );
}
