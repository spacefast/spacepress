"use client";

import { useState } from "react";
import { useMutation } from "spacepress/react";
import { api } from "../_generated/api";

export function ChecklistEditor({
  taskId,
  initialItems,
}: {
  taskId: number;
  initialItems: { index: number; label: string; done: boolean }[];
}) {
  const [items, setItems] = useState(initialItems);
  const [draft, setDraft] = useState("");
  const addItem = useMutation(api.addChecklistItem);
  const removeItem = useMutation(api.removeChecklistItem);
  const toggleItem = useMutation(api.toggleChecklistItem);

  const busy = addItem.pending || removeItem.pending || toggleItem.pending;
  const doneCount = items.filter((entry) => entry.done).length;
  const currentVersion = items
    .map((entry) => `${entry.done ? "1" : "0"}:${entry.label.length}:${entry.label}`)
    .join("|");

  return (
    <section className="inspector__card checklist-card" aria-label="Subtask checklist">
      <div className="checklist-card__head">
        <span className="inspector__label">Checklist</span>
        <span className="checklist-card__count">
          {doneCount}/{items.length}
        </span>
      </div>

      {items.length > 0 && (
        <ul className="checklist-list">
          {items.map((entry) => (
            <li key={entry.index} className={entry.done ? "checklist-item checklist-item--done" : "checklist-item"}>
              <button
                type="button"
                className={entry.done ? "todo-check todo-check--sm todo-check--done" : "todo-check todo-check--sm"}
                aria-pressed={entry.done}
                aria-label={entry.label}
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  const res = await toggleItem.mutate({
                    id: taskId,
                    index: entry.index,
                    expectedLabel: entry.label,
                    expectedVersion: currentVersion,
                  });
                  setItems(res.checklist.map((c, idx) => ({ index: idx, label: c.label, done: c.done })));
                }}
              >
                <span className="todo-check__mark" aria-hidden="true">{entry.done ? "✓" : ""}</span>
              </button>
              <span className="checklist-item__label">{entry.label}</span>
              <button
                type="button"
                className="checklist-item__remove"
                aria-label={`Remove ${entry.label}`}
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  const res = await removeItem.mutate({
                    id: taskId,
                    index: entry.index,
                    expectedLabel: entry.label,
                    expectedVersion: currentVersion,
                  });
                  setItems(res.checklist.map((c, idx) => ({ index: idx, label: c.label, done: c.done })));
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="checklist-add">
        <input
          type="text"
          className="field-input checklist-add__input"
          placeholder="Add a subtask…"
          value={draft}
          maxLength={200}
          onInput={(event: Event) => {
            setDraft((event.target as HTMLInputElement).value);
          }}
          onKeyDown={async (event: KeyboardEvent) => {
            if (event.key !== "Enter" || busy) return;
            event.preventDefault();
            const clean = draft.trim();
            if (clean === "") return;
            const res = await addItem.mutate({ id: taskId, label: clean });
            setItems(res.checklist.map((c, idx) => ({ index: idx, label: c.label, done: c.done })));
            setDraft("");
          }}
        />
        <button
          type="button"
          className="btn btn--subtle btn--xs"
          disabled={busy}
          onClick={async () => {
            const clean = draft.trim();
            if (clean === "" || busy) return;
            const res = await addItem.mutate({ id: taskId, label: clean });
            setItems(res.checklist.map((c, idx) => ({ index: idx, label: c.label, done: c.done })));
            setDraft("");
          }}
        >
          Add
        </button>
      </div>
    </section>
  );
}
