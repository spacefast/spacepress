// Server components content may use as blocks: `<Callout type="tip">…</Callout>` in a Markdown
// file is one block in the editor, rendered through this component.
import type { ReactNode } from "spacepress/app";

export const blocks = ["Callout", "Badge"];

export function Callout({ type, title, children }: { type: "note" | "tip" | "warning"; title?: string; children?: ReactNode }) {
  return (
    <aside className={`callout callout-${type}`} role="note">
      {title && <p className="callout-title">{title}</p>}
      <div className="callout-body">{children}</div>
    </aside>
  );
}

export function Badge({ label }: { label: string }) {
  return <span className="badge">{label}</span>;
}
