import { Show, type DynamicRow } from "@spacefast/zero-pages";

/** One note in a listing. Works for any query over notes: fields are per-request values. */
export function NoteCard({ note }: { note: DynamicRow<"notes"> }) {
  return (
    <article className="note-card">
      <h3><a href={note.href}>{note.title}</a></h3>
      <Show when={note.dek}>
        <p>{note.dek}</p>
      </Show>
    </article>
  );
}
