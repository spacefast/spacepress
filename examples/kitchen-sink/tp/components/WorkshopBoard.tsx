"use client";

import { sharedState, useEffect, useEvent, useLive, useMount, useRef, useState } from "typedpress/client";

export const display = sharedState({ open: false });

export function WorkshopBoard() {
  const board = useRef<HTMLElement>();
  const [ready, setReady] = useState(false);
  const openWorkshops = useLive<{ id: number; title: string }>("events", { where: { registrationOpen: true }, limit: 10 });
  useMount(() => { setReady(true); });
  useEffect(() => {
    if (display.open) board.current?.focus();
  }, [display.open]);
  useEvent("keydown", (event) => {
    if (event.key === "Escape") display.open = false;
  });
  return (
    <aside tabIndex={-1}>
      <button type="button" disabled={!ready} aria-expanded={display.open} onClick={() => { display.open = !display.open; }}>
        Workshops with open registration
      </button>
      {display.open && (
        <ul>{(openWorkshops.data ?? []).map((event) => <li key={event.id}>{event.title}</li>)}</ul>
      )}
    </aside>
  );
}
