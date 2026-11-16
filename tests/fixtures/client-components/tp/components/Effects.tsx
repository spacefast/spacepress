"use client";
import { useState, useEffect, useMount, useEvent, useRef, sharedState } from "typedpress/client";

export const cart = sharedState({ items: 0 });

export function Effects({ step }: { step: number }) {
  const [n, setN] = useState(0);
  const [seen, setSeen] = useState(0);
  const [width, setWidth] = useState(0);
  const box = useRef();
  useEffect(() => { setSeen(n * 10); }, [n]);
  useMount(() => { setWidth(-1); });
  useEvent("resize", () => { setWidth(window.innerWidth); });
  const add = () => { setN((v) => v + step); cart.items += 1; };
  const submit = (event: { preventDefault(): void }) => { event.preventDefault(); setN(0); };
  return (
    <form onSubmit={submit}>
      <output>{n}</output>
      <button type="button" onClick={add}>add</button>
      <i>{seen}</i>
      <u>{cart.items}</u>
    </form>
  );
}
