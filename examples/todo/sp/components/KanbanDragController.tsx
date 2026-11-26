"use client";

import { useState } from "react";
import { sharedState, useEvent } from "@spacepress/client/react";
import { moveTaskColumn } from "../server";

export const dragState = sharedState({ taskId: 0 });

export function KanbanDragController({ groupBy }: { groupBy: string }) {
  const [moving, setMoving] = useState(false);

  useEvent(
    "dragstart",
    (event) => {
      const target = event.target as HTMLElement | null;
      const card = target ? target.closest<HTMLElement>("[data-kanban-task-id]") : null;
      if (!card) return;
      const rawId = card.getAttribute("data-kanban-task-id") ?? "";
      const parsed = Number.parseInt(rawId, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) return;
      dragState.taskId = parsed;
      card.setAttribute("data-dragging", "true");
      const dt = (event as DragEvent).dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        dt.setData("text/plain", String(parsed));
      }
    },
    "document",
  );

  useEvent(
    "dragend",
    () => {
      dragState.taskId = 0;
      document.querySelectorAll("[data-dragging='true']").forEach((el) => {
        el.removeAttribute("data-dragging");
      });
      document.querySelectorAll("[data-drop-active='true']").forEach((el) => {
        el.removeAttribute("data-drop-active");
      });
    },
    "document",
  );

  useEvent(
    "dragover",
    (event) => {
      const target = event.target as HTMLElement | null;
      const col = target ? target.closest<HTMLElement>("[data-kanban-col]") : null;
      if (!col) return;
      event.preventDefault();
      document.querySelectorAll("[data-drop-active='true']").forEach((el) => {
        if (el !== col) el.removeAttribute("data-drop-active");
      });
      col.setAttribute("data-drop-active", "true");
    },
    "document",
  );

  useEvent(
    "drop",
    async (event) => {
      const target = event.target as HTMLElement | null;
      const col = target ? target.closest<HTMLElement>("[data-kanban-col]") : null;
      if (!col) return;
      event.preventDefault();
      col.removeAttribute("data-drop-active");

      const localTaskId = dragState.taskId;
      dragState.taskId = 0;
      if (!Number.isInteger(localTaskId) || localTaskId <= 0) return;

      const dt = (event as DragEvent).dataTransfer;
      const transferText = dt ? dt.getData("text/plain").trim() : "";
      if (transferText !== "" && transferText !== String(localTaskId)) return;
      const taskId = localTaskId;

      const bucketAttr = col.getAttribute("data-kanban-bucket-id") ?? "";
      const priorityAttr = col.getAttribute("data-kanban-priority") ?? "";
      const completeAttr = col.getAttribute("data-kanban-complete") === "true";

      setMoving(true);
      try {
        await moveTaskColumn({
          id: taskId,
          groupBy,
          targetBucketId: bucketAttr === "" ? null : Number.parseInt(bucketAttr, 10),
          targetPriority: priorityAttr === "" ? null : priorityAttr,
          complete: completeAttr,
        });
        window.location.reload();
      } catch {
        setMoving(false);
      }
    },
    "document",
  );

  return (
    <span className="kanban-status" role="status" aria-live="polite" hidden={!moving}>
      Moving card…
    </span>
  );
}
