"use client";

import { useRef, useState } from "react";
import { useEvent } from "spacepress/react";

export function DocsSearch({ entries, placeholder = "Search docs" }: { entries: unknown; placeholder?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const values = Array.isArray(entries) ? entries as unknown[] : [];
  const pages = values.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const title = "title" in entry ? entry.title : undefined;
    const href = "href" in entry ? entry.href : undefined;
    const section = "section" in entry ? entry.section : undefined;
    const description = "description" in entry ? entry.description : undefined;
    return typeof title === "string" && typeof href === "string" && typeof section === "string" && typeof description === "string"
      ? [{ title, href, section, description }]
      : [];
  });
  const normalized = query.trim().toLowerCase();
  const terms = normalized.split(/\s+/);
  const results = (
    normalized === ""
      ? pages
      : pages.filter((entry) => {
          const text = `${entry.title} ${entry.section} ${entry.description}`.toLowerCase();
          return terms.every((term) => typeof term === "string" && text.includes(term));
        })
  ).slice(0, 12);

  const show = () => {
    dialog.current?.showModal();
    dialog.current?.querySelector("input")?.focus();
  };
  const close = () => dialog.current?.close();
  useEvent(
    "keydown",
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialog.current?.open) close();
        else show();
        return;
      }
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select") !== null);
      if (!dialog.current?.open && event.key === "/" && !typing && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        show();
      }
    },
    "document",
  );
  return (
    <div className="sd-search">
      <button type="button" className="sd-search-trigger" onClick={show} aria-label={placeholder} aria-haspopup="dialog">
        <span className="sd-search-icon" aria-hidden="true" />
        <span className="sd-search-placeholder">{placeholder}</span>
        <kbd>⌘K</kbd>
      </button>
      <dialog
        ref={dialog}
        className="sd-search-dialog"
        aria-label={placeholder}
        onClick={(event: MouseEvent) => {
          if (event.target === dialog.current) close();
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.isComposing) return;
          const target = event.target;
          const field = target instanceof HTMLInputElement;
          if (!(target instanceof HTMLElement) || (!field && !target.matches("a"))) return;
          const links = Array.from(dialog.current?.querySelectorAll<HTMLElement>(".sd-search-results a") ?? []);
          if (links.length === 0) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const index = field ? -1 : links.indexOf(target);
            if (event.key === "ArrowDown") links[Math.min(index + 1, links.length - 1)]?.focus();
            else if (index > 0) links[index - 1]?.focus();
            else if (field) links[links.length - 1]?.focus();
            else dialog.current?.querySelector("input")?.focus();
          }
          if (field && event.key === "Enter") {
            event.preventDefault();
            links[0]?.click();
          }
        }}
      >
        <div className="sd-search-field">
          <span className="sd-search-icon" aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={placeholder}
            autoFocus
            aria-label={placeholder}
            onInput={(event: Event) => {
              if (event.target instanceof HTMLInputElement) setQuery(event.target.value);
            }}
          />
          <button type="button" className="sd-search-close" onClick={close} aria-label="Close search">Esc</button>
        </div>
        {results.length === 0 ? (
          <p className="sd-search-empty" role="status">No pages match.</p>
        ) : (
          <ul className="sd-search-results" aria-label="Search results">
            {results.map((entry) => (
              <li key={entry.href}>
                <a href={entry.href}>
                  <span className="sd-search-section">{entry.section}</span>
                  <span className="sd-search-title">{entry.title}</span>
                  {entry.description !== "" && <span className="sd-search-description">{entry.description}</span>}
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="sd-search-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>↵</kbd> to open</span>
        </p>
      </dialog>
    </div>
  );
}
