"use client";

import { useEffect, useRef, useState } from "react";
import { sharedState, useEvent } from "@spacepress/client/react";

export const shortcutState = sharedState({ activeIndex: -1 });

export function TodoShortcuts({ hasInspector }: { hasInspector: boolean }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButton = useRef<HTMLButtonElement>();

  useEffect(() => {
    if (!helpOpen) {
      helpButton.current?.blur();
    }
  }, [helpOpen]);

  useEvent("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    const tag = target ? target.tagName.toLowerCase() : "";
    const inEditable = tag === "input" || tag === "textarea" || tag === "select" || Boolean(target?.isContentEditable);

    if (event.key === "Escape") {
      if (helpOpen) {
        setHelpOpen(false);
        return;
      }
      if (inEditable && target) {
        target.blur();
        return;
      }
      if (hasInspector) {
        const closeLink = document.getElementById("inspector-close-link") as HTMLAnchorElement | null;
        if (closeLink) closeLink.click();
      }
      return;
    }

    if (inEditable || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "n") {
      event.preventDefault();
      const input = document.getElementById("quick-add-title") as HTMLInputElement | null;
      input?.focus();
      return;
    }

    if (event.key === "/") {
      event.preventDefault();
      const searchInput = document.getElementById("todo-search-input") as HTMLInputElement | null;
      searchInput?.focus();
      return;
    }

    if (event.key === "?") {
      event.preventDefault();
      setHelpOpen(!helpOpen);
      return;
    }

    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-task-row]"));
    if (rows.length === 0) return;

    if (event.key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.min(rows.length - 1, shortcutState.activeIndex + 1);
      shortcutState.activeIndex = next;
      rows.forEach((row, idx) => row.setAttribute("data-kbd-focus", idx === next ? "true" : "false"));
      rows[next]?.scrollIntoView({ block: "nearest" });
      return;
    }

    if (event.key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(0, shortcutState.activeIndex <= 0 ? 0 : shortcutState.activeIndex - 1);
      shortcutState.activeIndex = next;
      rows.forEach((row, idx) => row.setAttribute("data-kbd-focus", idx === next ? "true" : "false"));
      rows[next]?.scrollIntoView({ block: "nearest" });
      return;
    }

    if (event.key === "x" && shortcutState.activeIndex >= 0) {
      const row = rows[shortcutState.activeIndex];
      const checkBtn = row?.querySelector<HTMLButtonElement>(".todo-check");
      if (checkBtn) {
        event.preventDefault();
        checkBtn.click();
      }
      return;
    }

    if (event.key === "Enter" && shortcutState.activeIndex >= 0) {
      const row = rows[shortcutState.activeIndex];
      const link = row?.querySelector<HTMLAnchorElement>(".task-row__title");
      if (link) {
        event.preventDefault();
        link.click();
      }
    }
  });

  return (
    <div className="kbd-help">
      <button
        ref={helpButton}
        type="button"
        className="kbd-help__trigger"
        aria-expanded={helpOpen}
        onClick={() => {
          setHelpOpen(!helpOpen);
        }}
      >
        <kbd>?</kbd> Shortcuts
      </button>
      <div className="kbd-help__popover" hidden={!helpOpen} role="dialog" aria-label="Keyboard shortcuts">
        <div className="kbd-help__row"><span>Quick add task</span><kbd>N</kbd></div>
        <div className="kbd-help__row"><span>Search tasks</span><kbd>/</kbd></div>
        <div className="kbd-help__row"><span>Move selection</span><span><kbd>J</kbd> / <kbd>K</kbd></span></div>
        <div className="kbd-help__row"><span>Complete focused</span><kbd>X</kbd></div>
        <div className="kbd-help__row"><span>Inspect focused</span><kbd>Enter</kbd></div>
        <div className="kbd-help__row"><span>Close inspector</span><kbd>Esc</kbd></div>
      </div>
    </div>
  );
}
