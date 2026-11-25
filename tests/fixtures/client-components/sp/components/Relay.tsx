"use client";
import { useMount, useState } from "spacepress/client";

// Handlers that call each other: one awaited for its answer, one called for its value, one called
// from a callback inside a handler, and one started by a mount callback that does not wait for it.
export function Relay({ base }: { base: number }) {
  const [total, setTotal] = useState(0);
  const [steps, setSteps] = useState("start");
  const [loaded, setLoaded] = useState(0);
  const [shown, setShown] = useState("unseen");
  const twice = (n: number) => n * 2;
  const note = (word: string) => { setSteps((s) => `${s},${word}`); };
  // Waits a turn, as a handler that asks the server does.
  const later = async (n: number) => { return await window.Promise.resolve(n + 100); };
  const load = async () => { setLoaded(await later(base)); };
  const run = async () => {
    note("run");
    const answer = await later(base);
    setTotal(twice(answer));
    ["a", "b"].forEach((word) => { note(word); });
    note("done");
  };
  const show = () => { setShown(`${loaded}`); };
  useMount(() => { load(); });
  return (
    <p>
      <button type="button" className="relay-run" onClick={run}>relay</button>
      <button type="button" className="relay-show" onClick={show}>reveal</button>
      <b className="relay-total">{total}</b>
      <em className="relay-steps">{steps}</em>
      <span className="relay-shown">{shown}</span>
    </p>
  );
}
