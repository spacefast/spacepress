"use client";
import { useState } from "first/client";
export function Pair() {
  const [n] = useState(0);
  return <><b>{n}</b><i>{n}</i></>;
}
