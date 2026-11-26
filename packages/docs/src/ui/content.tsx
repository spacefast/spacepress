// Components a Markdown page writes as tags. Each one takes only text, number and boolean props,
// which is what a Markdown tag can hold; what sits between the tags is Markdown.
import type { ReactNode } from "spacepress/app";
import { Icon } from "./Icon";

const CALLOUT_ICONS = {
  note: "info",
  info: "info",
  tip: "lightbulb",
  warning: "triangle-alert",
  danger: "circle-x",
  check: "circle-check",
};

/** A highlighted aside: a note, tip, warning, danger, or check. */
export function Callout({
  type = "note",
  title,
  icon,
  children,
}: {
  type?: "note" | "info" | "tip" | "warning" | "danger" | "check";
  title?: string;
  icon?: string;
  children?: ReactNode;
}) {
  return (
    <aside className={`sd-callout sd-callout-${type}`} role="note">
      <span className="sd-callout-icon">
        <Icon name={icon ?? CALLOUT_ICONS[type]} size={16} />
      </span>
      <div className="sd-callout-body">
        {title && <p className="sd-callout-title">{title}</p>}
        {children}
      </div>
    </aside>
  );
}

export function Note({ title, children }: { title?: string; children?: ReactNode }) {
  return <Callout type="note" title={title}>{children}</Callout>;
}
export function Tip({ title, children }: { title?: string; children?: ReactNode }) {
  return <Callout type="tip" title={title}>{children}</Callout>;
}
export function Warning({ title, children }: { title?: string; children?: ReactNode }) {
  return <Callout type="warning" title={title}>{children}</Callout>;
}
export function Danger({ title, children }: { title?: string; children?: ReactNode }) {
  return <Callout type="danger" title={title}>{children}</Callout>;
}

/** A link card with an icon, a title, and a short blurb. Without `href` it doesn't link. */
export function Card({
  title,
  href,
  icon,
  cta,
  horizontal = false,
  children,
}: {
  title?: string;
  href?: string;
  icon?: string;
  cta?: string;
  horizontal?: boolean;
  children?: ReactNode;
}) {
  const className = horizontal ? "sd-card sd-card-horizontal" : "sd-card";
  const inner = (
    <>
      {icon && (
        <span className="sd-card-icon">
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="sd-card-text">
        {title && <span className="sd-card-title">{title}</span>}
        {children && <span className="sd-card-body">{children}</span>}
        {cta && href && <span className="sd-card-cta">{cta} →</span>}
      </span>
      {href && !cta && (
        <span className="sd-card-arrow">
          <Icon name={href.startsWith("http") ? "arrow-up-right" : "arrow-right"} size={14} />
        </span>
      )}
    </>
  );
  return href ? (
    <a className={`${className} sd-card-link`} href={href}>
      {inner}
    </a>
  ) : (
    <div className={className}>{inner}</div>
  );
}

/** A responsive grid of cards. */
export function CardGroup({ cols = 2, children }: { cols?: number; children?: ReactNode }) {
  return (
    <div className="sd-grid" style={{ "--sd-cols": `${cols}` }}>
      {children}
    </div>
  );
}

/** A responsive grid of any blocks; each cell is a `Column`. */
export function Columns({ cols = 2, children }: { cols?: number; children?: ReactNode }) {
  return (
    <div className="sd-grid" style={{ "--sd-cols": `${cols}` }}>
      {children}
    </div>
  );
}
export function Column({ children }: { children?: ReactNode }) {
  return <div className="sd-column">{children}</div>;
}

/** A numbered sequence of steps; each child is a `Step`. */
export function Steps({ children }: { children?: ReactNode }) {
  return <div className="sd-steps">{children}</div>;
}
export function Step({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="sd-step">
      <p className="sd-step-title">{title}</p>
      <div className="sd-step-body">{children}</div>
    </div>
  );
}

/** Collapsible sections in one bordered box; each child is an `AccordionItem`. */
export function Accordion({ children }: { children?: ReactNode }) {
  return <div className="sd-accordion">{children}</div>;
}
export function AccordionItem({
  title,
  description,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  icon?: string;
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  return (
    <details className="sd-accordion-item" open={defaultOpen}>
      <summary>
        {icon && <Icon name={icon} size={16} />}
        <span className="sd-accordion-title">
          {title}
          {description && <small>{description}</small>}
        </span>
        <span className="sd-chevron">
          <Icon name="chevron-down" size={16} />
        </span>
      </summary>
      <div className="sd-accordion-body">{children}</div>
    </details>
  );
}

/** One inline disclosure, for optional detail. */
export function Expandable({
  title = "Show more",
  defaultOpen = false,
  children,
}: {
  title?: string;
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  return (
    <details className="sd-expandable" open={defaultOpen}>
      <summary>
        <span className="sd-chevron">
          <Icon name="chevron-right" size={14} />
        </span>
        {title}
      </summary>
      <div className="sd-expandable-body">{children}</div>
    </details>
  );
}

/** A small label: a version, a status, a stability level. */
export function Badge({
  variant = "default",
  children,
}: {
  variant?: "default" | "accent" | "success" | "warning" | "danger";
  children?: ReactNode;
}) {
  return <span className={`sd-badge sd-badge-${variant}`}>{children}</span>;
}

/** A titled box for set-aside content. */
export function Panel({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <section className="sd-panel">
      {title && <p className="sd-panel-title">{title}</p>}
      {children}
    </section>
  );
}

/** A centered, bordered frame around an image or any visual, with an optional caption. */
export function Frame({ caption, hint, children }: { caption?: string; hint?: string; children?: ReactNode }) {
  return (
    <figure className="sd-frame">
      {hint && <p className="sd-frame-hint">{hint}</p>}
      <div className="sd-frame-body">{children}</div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/** A clickable tile that leads with a visual (its children), then a title and description. */
export function Tile({
  title,
  description,
  href,
  children,
}: {
  title: string;
  description?: string;
  href: string;
  children?: ReactNode;
}) {
  return (
    <a className="sd-tile" href={href}>
      <span className="sd-tile-visual">{children}</span>
      <span className="sd-tile-title">{title}</span>
      {description && <span className="sd-tile-description">{description}</span>}
    </a>
  );
}

/** A hint on hover or focus for an inline term. */
export function Tooltip({ tip, headline, children }: { tip: string; headline?: string; children?: ReactNode }) {
  return (
    <span className="sd-tooltip" tabIndex={0}>
      {children}
      <span className="sd-tooltip-bubble" role="tooltip">
        {headline && <strong>{headline}</strong>}
        {tip}
      </span>
    </span>
  );
}

/** A keyboard key. */
export function Kbd({ children }: { children?: ReactNode }) {
  return <kbd className="sd-kbd">{children}</kbd>;
}

/** A YouTube video in a 16:9 frame from youtube-nocookie.com. */
export function YouTube({ id, title = "YouTube video", start }: { id: string; title?: string; start?: number }) {
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}${start ? `?start=${start}` : ""}`;
  return (
    <div className="sd-video">
      <iframe
        src={src}
        title={title}
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

/** A file and folder tree; children are `Folder` and `File`. */
export function FileTree({ children }: { children?: ReactNode }) {
  return <div className="sd-tree" role="tree">{children}</div>;
}
export function Folder({ name, defaultOpen = true, children }: { name: string; defaultOpen?: boolean; children?: ReactNode }) {
  return (
    <details className="sd-tree-folder" open={defaultOpen} role="treeitem">
      <summary>
        <Icon name="folder" size={15} />
        <span>{name}</span>
      </summary>
      <div className="sd-tree-children" role="group">{children}</div>
    </details>
  );
}
export function File({ name, highlight = false }: { name: string; highlight?: boolean }) {
  return (
    <div className={highlight ? "sd-tree-file is-highlighted" : "sd-tree-file"} role="treeitem">
      <Icon name="file" size={15} />
      <span>{name}</span>
    </div>
  );
}

/** One documented prop or field: its name, type, default, and whether it is required. */
export function Field({
  name,
  type,
  required = false,
  defaultValue,
  children,
}: {
  name: string;
  type: string;
  required?: boolean;
  defaultValue?: string;
  children?: ReactNode;
}) {
  return (
    <div className="sd-field">
      <p className="sd-field-head">
        <code className="sd-field-name">{name}</code>
        <code className="sd-field-type">{type}</code>
        {required && <span className="sd-badge sd-badge-danger">required</span>}
        {defaultValue && (
          <span className="sd-field-default">
            default <code>{defaultValue}</code>
          </span>
        )}
      </p>
      <div className="sd-field-body">{children}</div>
    </div>
  );
}
