"use client";

import { useState } from "spacepress/client";
import { toggleTask } from "../server";

export function TaskCheckButton({
  taskId,
  completed,
  label,
}: {
  taskId: number;
  completed: boolean;
  label: string;
}) {
  const [done, setDone] = useState(completed);
  const [busy, setBusy] = useState(false);

  const onToggle = async () => {
    if (busy) return;
    setBusy(true);
    setDone(!done);
    try {
      const result = await toggleTask({ id: taskId });
      setDone(result.completed);
      window.location.reload();
    } catch {
      setDone(completed);
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={done ? "todo-check todo-check--done" : "todo-check"}
      aria-label={label}
      aria-pressed={done}
      disabled={busy}
      onClick={onToggle}
    >
      <span className="todo-check__mark" aria-hidden="true">
        {done ? "✓" : ""}
      </span>
    </button>
  );
}
