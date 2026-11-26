"use client";
import { useState } from "react";
import { useEvent } from "spacepress/react";

// Ordinary browser code in handlers: loops with labels, `break` and `continue`, `switch`,
// `for … in`, an async callback that awaits inside an async handler, browser globals, and
// assigning page properties (`document.title`, `window.location.href`).
export function Loops({ items }: { items: number[] }) {
  const [total, setTotal] = useState(0);
  const [kind, setKind] = useState("none");
  const [copied, setCopied] = useState("-");
  const sum = () => {
    let t = 0;
    outer: for (const x of items) {
      if (x < 0) continue;
      for (let i = 0; i < x; i++) {
        if (i === 3) continue outer;
        t++;
      }
    }
    let j = 0;
    while (true) {
      j++;
      if (j >= 2) break;
    }
    do {
      t += j;
    } while (false);
    for (const key in { a: 1, bb: 2 }) t += key.length;
    switch (t) {
      case 0:
        setKind("zero");
        break;
      default:
        setKind("some");
    }
    setTotal(t);
  };
  useEvent("keydown", async (event) => {
    const res = await fetch("/items.json");
    const rows: { href: string }[] = await res.json();
    await new Promise<void>((resolve) => {
      setTimeout(async () => {
        await navigator.clipboard.writeText(rows[0].href);
        document.title = rows[0].href;
        resolve();
      }, 0);
    });
    setCopied(document.title);
    if (event.key === "k") window.location.href = rows[0].href;
  }, "document");
  return (
    <button type="button" onClick={sum} data-kind={kind}>
      {total} {copied}
    </button>
  );
}
