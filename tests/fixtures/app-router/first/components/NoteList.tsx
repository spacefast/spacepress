export function NoteList({ notes }: { notes: string[] }) {
  return <ul>{notes.map((t) => <li key={t}>{t}</li>)}</ul>;
}
