// Server components content may use as blocks: in a Markdown file, `<Callout type="warning">…</Callout>`.
import type { ReactNode } from "typedpress/app";

export const blocks = ["Callout", "Badge", "Status"];

export function Callout({ type, title, children }: { type: "note" | "warning"; title?: string; children?: ReactNode }) {
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

// Optional props only, and nothing to show until it has a label.
export function Status({ label, kind }: { label?: string; kind?: "draft" | "live" }) {
  return label ? <em className={`status status-${kind ?? "none"}`}>{label}</em> : null;
}
