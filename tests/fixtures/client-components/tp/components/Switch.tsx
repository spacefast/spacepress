"use client";
import { useState } from "typedpress/client";
import { Badge } from "./Badge";

// A client component that renders a server component (Badge.tsx): the badge is server HTML,
// rendered once with `on={true}`, and the Switch's own `on` state never reaches it.
export function Switch() {
  const [on, setOn] = useState(false);
  return <div className="switch"><button type="button" onClick={() => setOn(!on)}>{on ? "on" : "off"}</button><Badge on={true} /></div>;
}
