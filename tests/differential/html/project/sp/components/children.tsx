// React's child rules: what renders, what renders nothing, and how numbers print.
export function Values({ n, s, items }: { n: number; s: string; items: string[] }) {
  return (
    <div>
      <p>{null}{undefined}{false}{true}</p>
      <p>{0}|{n}|{-0}|{NaN}|{1e21}|{1.5e-7}|{2 ** 53}</p>
      <p>{s}</p>
      <p>{items}</p>
      <p>{[["a", ["b"]], "c", null, 1]}</p>
      <p>{""}{"x"}{""}</p>
    </div>
  );
}

// `&&`, `?:` and `??` keep JavaScript's values: `{0 && <b/>}` renders 0.
export function Conditions({ count, dek, label, flag }: { count: number; dek: string | null; label?: string; flag: boolean }) {
  return (
    <section>
      {count && <b>has {count}</b>}
      {dek && <p className="dek">{dek}</p>}
      {flag ? <em>on</em> : <i>off</i>}
      <span>{label ?? "none"}</span>
      {count > 1 ? `${count} items` : count === 1 ? "1 item" : "empty"}
      {!flag && "not flagged"}
    </section>
  );
}

type Note = { id: number; title: string; tags: string[]; body: string };

// `.length`, `.map` with keys, and string and array methods on request data.
export function Methods({ notes, query }: { notes: Note[]; query: string }) {
  const found = notes.filter((n) => n.title.toLowerCase().includes(query.toLowerCase()));
  return (
    <div>
      <h2>{found.length} of {notes.length} match “{query.trim()}”</h2>
      <ul>
        {found.map((n, i) => (
          <li key={n.id} data-index={i}>
            {n.title.toUpperCase()} — {n.tags.join(", ")} ({n.body.slice(0, 5)}…)
            {n.tags.length === 0 && <small>untagged</small>}
          </li>
        ))}
      </ul>
      <p>{notes.map((n) => n.id).reduce((a, b) => a + b, 0)}</p>
    </div>
  );
}
