"use client";
// Generator B parity: the first render of client components, compared with React once the
// compiler's own `data-wp-*` attributes and text spans are set aside.
import { useState } from "first/client";

export function Counter({ start, label }: { start: number; label: string }) {
  const [count, setCount] = useState(start);
  const [busy, setBusy] = useState(false);
  const text = count === 1 ? "1 click" : `${count} clicks`;
  return (
    <div className={busy ? "busy" : "idle"}>
      <p>{label}: {text}</p>
      <button disabled={busy} onClick={() => setCount(count + 1)}>+1</button>
      <button onClick={() => setBusy(!busy)}>toggle</button>
      <span>{count}</span>
    </div>
  );
}

export function Styled({ color, on }: { color: string; on: boolean }) {
  const [size, setSize] = useState(12);
  return (
    <section className={{ active: on }.active ? "active" : ""} style={{ color, fontSize: size }} title={`${size}px`} aria-pressed={on}>
      <b>{size * 2}</b> {color}
      <input value={color} readOnly onInput={() => setSize(size + 1)} />
    </section>
  );
}
