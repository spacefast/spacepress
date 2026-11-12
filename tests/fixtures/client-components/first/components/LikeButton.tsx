"use client";
import { useState } from "first/client";
import { like } from "../server";

export function LikeButton({ postId, count: initial }: { postId: number; count: number }) {
  const [count, setCount] = useState(initial);
  const [busy, setBusy] = useState(false);
  const label = count === 1 ? "1 like" : `${count} likes`;
  return (
    <button disabled={busy} onClick={async () => { setBusy(true); setCount(await like({ postId })); setBusy(false); }}>
      ♥ {label}
    </button>
  );
}
