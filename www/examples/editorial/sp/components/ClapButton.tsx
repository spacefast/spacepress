"use client";
import { useState } from "spacepress/client";
import { clap } from "../actions";

export function ClapButton({ articleId, initial }: { articleId: number; initial: number }) {
  const [count, setCount] = useState(initial);
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await clap({ articleId });
        setCount(res.count);
        setBusy(false);
      }}
    >
      {count} {count === 1 ? "clap" : "claps"}
    </button>
  );
}
