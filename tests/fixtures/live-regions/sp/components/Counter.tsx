"use client";
import { useState } from "react";

// State the browser holds, inside a live region: an update of a sibling must keep it.
export function Counter() {
  const [n, setN] = useState(0);
  return <button type="button" className="counter" onClick={() => setN(n + 1)}>clicked {n}</button>;
}
