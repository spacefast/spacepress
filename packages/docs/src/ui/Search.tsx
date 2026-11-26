"use client";
// ⌘K search over the docs. The server hands the island every page's title, section and
// description; matching runs in the browser, so there is no index to build or host to call.
import { useEvent, useState } from "spacepress/client";

export interface SearchEntry {
  title: string;
  href: string;
  section: string;
  description: string;
}

export function DocsSearch({ entries, placeholder = "Search docs" }: { entries: SearchEntry[]; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The highlighted result, by its href: the arrow keys move it, Enter opens it.
  const [active, setActive] = useState("");
  const terms: string[] = query.trim().toLowerCase().split(" ").filter((t: string) => t !== "");
  const results = (
    terms.length === 0
      ? entries
      : entries.filter((entry) => {
          const hay = `${entry.title} ${entry.section} ${entry.description}`.toLowerCase();
          return terms.every((t: string) => hay.includes(t));
        })
  ).slice(0, 12);
  const current = results.findIndex((entry) => entry.href === active);
  const show = () => {
    setOpen(true);
    setActive("");
  };
  useEvent(
    "keydown",
    (event) => {
      const target = event.target as HTMLElement | null;
      const typing = target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) setOpen(false);
        else show();
        return;
      }
      if (!open && event.key === "/" && !typing) {
        event.preventDefault();
        show();
        return;
      }
      if (!open) return;
      if (event.key === "Escape") setOpen(false);
      if (results.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive(results[Math.min(current + 1, results.length - 1)].href);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive(results[Math.max(current - 1, 0)].href);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        window.location.assign(results[Math.max(current, 0)].href);
      }
    },
    "document",
  );
  return (
    <div className="sd-search">
      <button type="button" className="sd-search-trigger" onClick={show} aria-label={placeholder}>
        <span className="sd-search-icon" aria-hidden="true" />
        <span className="sd-search-placeholder">{placeholder}</span>
        <kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="sd-search-backdrop" onClick={() => setOpen(false)}>
          <div className="sd-search-dialog" role="dialog" aria-modal="true" aria-label={placeholder} onClick={(event) => event.stopPropagation()}>
            <div className="sd-search-field">
              <span className="sd-search-icon" aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder={placeholder}
                autoFocus
                aria-label={placeholder}
                onInput={(event) => {
                  setQuery((event.target as HTMLInputElement).value);
                  setActive("");
                }}
              />
              <kbd>Esc</kbd>
            </div>
            {results.length === 0 ? (
              <p className="sd-search-empty">No pages match.</p>
            ) : (
              <ul className="sd-search-results" role="listbox">
                {results.map((entry) => (
                  <li key={entry.href}>
                    <a href={entry.href} role="option" aria-selected={entry.href === active ? "true" : "false"}>
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
          </div>
        </div>
      )}
    </div>
  );
}
