"use client";
import { useState, useRef } from "react";

// Code that runs after its handler returns, and handlers calling each other: a timer, a listener
// and a promise callback read a derived value, a ref and another handler; an async handler awaits
// an async one and calls a plain one; a `const` arrow calls itself; a name declared in a block
// isn't seen after it; parameters with defaults, rest and destructuring; `for await` in an async
// callback; a `function` expression.
export function Later({ items }: { items: number[] }) {
  const [n, setN] = useState(1);
  const [log, setLog] = useState("-");
  const doubled = n * 2;
  const box = useRef();
  const bump = (by = doubled - n) => {
    const next = n + by;
    setN(next);
    return next;
  };
  const load = async ([value = doubled]: number[] = []) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return value;
  };
  const run = async () => {
    const got = await load();
    const was = bump();
    const seen: number[] = [];
    switch (got) {
      case 1: {
        const items = [0];
        seen.push(items.length);
        break;
      }
      default:
        seen.push(items.length);
    }
    {
      function firstItem() { return items[0]; }
      const items = [0];
      seen.push(firstItem());
    }
    seen.push(items.length);
    let ticks = 0;
    await new Promise<void>((done) => {
      const tick = () => {
        ticks++;
        if (ticks < 3) setTimeout(tick, 0);
        else done();
      };
      tick();
    });
    let later = 0;
    let heard = 0;
    let tag = "none";
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        later = doubled;
        document.body.addEventListener("later", async () => { heard = bump(await Promise.resolve(1)); resolve(); }, { once: true });
        document.body.dispatchEvent(new Event("later"));
        tag = box.current?.tagName ?? "none";
      }, 0);
    });
    const odd = [1, 2, 3].filter(function keep(x) { return x % 2 === 1; }).length;
    const sum = await (async () => {
      let t = 0;
      for await (const v of [Promise.resolve(1), 2]) t += v;
      return t;
    })();
    const pick = ({ a }: { a: number }, b = 10, ...more: number[]) => a + b + more.length;
    setLog(`${got} ${was} ${seen.join(",")} ${ticks} ${later} ${heard} ${tag} ${odd} ${sum} ${pick({ a: 1 }, undefined, 7, 8)} ${n}`);
  };
  return (
    <button type="button" className="later" ref={box} onClick={run}>
      {log}
    </button>
  );
}
