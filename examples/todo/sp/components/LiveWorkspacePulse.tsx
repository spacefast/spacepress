"use client";

import { useLive, useMount, useState } from "spacepress/client";

export function LiveWorkspacePulse({ initialOpen }: { initialOpen: number }) {
  const [connected, setConnected] = useState(false);
  const live = useLive<{ id: number }>("tasks", {
    where: { completedAt: { isNull: true } },
    columns: { id: true },
    limit: 200,
  });
  const count = live.data ? live.data.length : initialOpen;
  useMount(() => {
    setConnected(true);
  });

  return (
    <span className="todo-pulse" title="Live count synced via SpacePress useLive()">
      <span className={connected ? "todo-pulse__dot todo-pulse__dot--live" : "todo-pulse__dot"} aria-hidden="true" />
      <span>{count} open</span>
    </span>
  );
}
