"use client";
import { useState } from "typedpress/client";
import { cheer } from "../actions";

export function Cheer({ noteId }: { noteId: number }) {
  const [count, setCount] = useState(0);
  return <button type="button" className="cheer" onClick={async () => setCount((await cheer({ noteId })).count)}>{count} cheers</button>;
}
