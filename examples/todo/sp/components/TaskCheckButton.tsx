"use client";

import { useState } from "react";
import { useMutation } from "spacepress/react";
import { api } from "../_generated/api";

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
  const toggle = useMutation(api.toggleTask);

  const onToggle = async () => {
    if (toggle.pending) return;
    setDone(!done);
    try {
      const result = await toggle.mutate({ id: taskId });
      setDone(result.completed);
      window.location.reload();
    } catch {
      setDone(completed);
    }
  };

  return (
    <button
      type="button"
      className={done ? "todo-check todo-check--done" : "todo-check"}
      aria-label={label}
      aria-pressed={done}
      disabled={toggle.pending}
      onClick={onToggle}
    >
      <span className="todo-check__mark" aria-hidden="true">
        {done ? "✓" : ""}
      </span>
    </button>
  );
}
