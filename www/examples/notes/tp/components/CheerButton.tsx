"use client";
// Rendered on the server like any component, then hydrated with the Interactivity API: a click
// calls the `cheer` action and shows the stored count it returns.
import { useState } from "typedpress/client";
import { cheer } from "../server";

export function CheerButton({ noteId, count: initial }: { noteId: number; count: number }) {
  const [count, setCount] = useState(initial);
  const [busy, setBusy] = useState(false);
  const label = count === 1 ? "1 cheer" : `${count} cheers`;
  return (
    <button
      type="button"
      className="cheer"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setCount((await cheer({ noteId })).count);
        setBusy(false);
      }}
    >
      {label}
    </button>
  );
}
