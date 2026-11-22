import { useState } from "preact/hooks";
import { useMutation, useQuery } from "@spacefast/zero/client";
import { label } from "../shared/format";

type Note = { id: string; title: string; done: boolean };

export function Shelf({ name }: { name: string }) {
  const notes = useQuery<Note[]>("onShelf", name);
  const add = useMutation<[string, string], Note>("add");
  const setDone = useMutation<[string, boolean], Note | null>("setDone");
  const [title, setTitle] = useState("");
  return (
    <section class="rounded-lg border border-line bg-surface p-4">
      <h2 class="text-lg font-semibold text-ink">{name}</h2>
      <ul>
        {notes.map((n) => (
          <li key={n.id} onClick={() => setDone(n.id, !n.done)}>{label(n.title, n.done)}</li>
        ))}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); void add(name, title); setTitle(""); }}>
        <input value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        <button type="submit" class="bg-accent px-3 py-1 text-white">Add</button>
      </form>
    </section>
  );
}
