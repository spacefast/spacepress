"use client";
// Rendered on the server like any component, then hydrated with the Interactivity API: a click
// calls the `cheer` action via `useMutation(api.cheer)` and shows the stored count.
import { useState } from "react";
import { useMutation } from "spacepress/react";
import { api } from "../_generated/api";

export function CheerButton({ noteId, count: initial }: { noteId: number; count: number }) {
  const [count, setCount] = useState(initial);
  const cheer = useMutation(api.cheer);
  const label = count === 1 ? "1 cheer" : `${count} cheers`;
  return (
    <button
      type="button"
      className="cheer"
      disabled={cheer.pending}
      onClick={async () => {
        setCount((await cheer.mutate({ noteId })).count);
      }}
    >
      {label}
    </button>
  );
}
