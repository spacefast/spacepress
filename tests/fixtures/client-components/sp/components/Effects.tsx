"use client";
import { useState, useEffect, useRef } from "react";
import { useMount, useEvent, sharedState } from "@spacepress/client/react";

export const cart = sharedState({ items: 0 });

export function Effects({ step }: { step: number }) {
  const [n, setN] = useState(0);
  const [seen, setSeen] = useState(0);
  const [width, setWidth] = useState(0);
  const [tag, setTag] = useState("unmeasured");
  const box = useRef();
  useEffect(() => { setSeen(n * 10); }, [n]);
  useMount(() => { setWidth(-1); });
  useEvent("resize", () => { setWidth(window.innerWidth); });
  const add = () => { setN((v) => v + step); cart.items += 1; };
  const measure = () => { setTag(box.current?.tagName ?? "none"); };
  const submit = (event: { preventDefault(): void }) => { event.preventDefault(); setN(0); };
  return (
    <form onSubmit={submit}>
      <output ref={box}>{n}</output>
      <button type="button" onClick={add}>add</button>
      <button type="button" className="measure" onClick={measure}>{tag}</button>
      <i>{seen}</i>
      <u>{cart.items}</u>
    </form>
  );
}
