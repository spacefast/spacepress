"use client";
import { useState } from "react";
export function Pair() {
  const [n] = useState(0);
  return <><b>{n}</b><i>{n}</i></>;
}
