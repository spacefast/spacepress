// Server components content may use as blocks: in a Markdown file, `<Callout type="warning">…</Callout>`.
export const blocks = ["Callout", "Badge"];

export function Callout({ type, title, children }: { type: "note" | "warning"; title?: string; children?: JSX.Element }) {
  return (
    <aside className={`callout callout-${type}`} role="note">
      {title && <p className="callout-title">{title}</p>}
      <div className="callout-body">{children}</div>
    </aside>
  );
}

export function Badge({ label, count }: { label: string; count?: number }) {
  return <span className="badge">{label}{count !== undefined && <b> {count}</b>}</span>;
}
