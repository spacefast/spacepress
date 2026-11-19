"use client";

import { sharedState, useEffect, useEvent, useLive, useMount, useRef, useState } from "typedpress/client";

export const display = sharedState({ dismissals: 0 });

export function WorkshopBoard() {
  const board = useRef<HTMLElement>();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const openWorkshops = useLive<{ id: number }>("events", {
    where: { registrationOpen: true }, columns: { id: true }, limit: 100,
  });
  const workshops = openWorkshops.data;
  const count = workshops ? workshops.length : 0;
  useMount(() => { setReady(true); });
  useEffect(() => {
    if (display.dismissals > 0) board.current?.querySelector("button")?.focus();
  }, [display.dismissals]);
  useEvent("keydown", (event) => {
    if (open && event.key === "Escape") {
      setOpen(false);
      display.dismissals += 1;
    }
  });

  return (
    <aside>
      <button type="button" disabled={!ready} aria-expanded={open} onClick={() => { setOpen(!open); }}>
        Workshops with open registration
      </button>
      <p hidden={!open}>{count} workshops have open registration.</p>
    </aside>
  );
}
