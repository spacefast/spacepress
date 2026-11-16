import { Section, Code, Built, Decided } from "../Guide";

export function Client() {
  return (
    <>
      <Section id="client" />
      <p><Built /> A file that starts with <code>"use client"</code> is rendered on the server first, then stays interactive in the browser through the WordPress Interactivity API. It can call your mutations directly.</p>
      <Code file="tp/app/blog/[slug]/LikeButton.tsx">{`"use client";
import { useState } from "typedpress/state";
import { like } from "../../../server";

export function LikeButton({ id, count: start }: { id: number; count: number }) {
  const [count, setCount] = useState(start);
  return <button onClick={async () => { await like({ id }); setCount(count + 1); }}>{count} likes</button>;
}`}</Code>
      <div className="scroll"><table>
      <tr><th>Hook</th><th>For</th></tr>
      <tr><td><code>useState</code>, <code>useRef</code></td><td>state of one component</td></tr>
      <tr><td><code>useEffect</code>, <code>useMount</code></td><td>code that runs in the browser after render</td></tr>
      <tr><td><code>useEvent("resize", fn)</code></td><td>window and document listeners</td></tr>
      <tr><td><code>{"sharedState({ … })"}</code></td><td>state shared by several components on a page</td></tr>
      <tr><td><code>{"useQuery(popular, { limit: 5 })"}</code></td><td>a read that stays current (<Decided />; called <code>useLive</code> today)</td></tr>
      </table></div>
      <p className="cap">These are not React. A client component cannot import React components from npm.</p>
    </>
  );
}
