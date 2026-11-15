// A component Markdown may use as a block: `<Callout type="tip" title="…">…</Callout>` in a doc or
// a post is one block in the WordPress editor, rendered through this component.
import type { ReactNode } from "first/app";

export const blocks = ["Callout"];

export function Callout({ type, title, children }: { type: "note" | "tip" | "warning"; title?: string; children?: ReactNode }) {
  return (
    <aside className={`callout callout-${type}`} role="note">
      {title && <p className="callout-title">{title}</p>}
      <div className="callout-body">{children}</div>
    </aside>
  );
}
