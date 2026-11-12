// A comment and another directive may come before "use client": it still marks a client component.
"use strict";
"use client";
import { useState } from "first/client";

export function Toggle() {
  const [on, setOn] = useState(false);
  return <button onClick={() => setOn(!on)}>{on ? "on" : "off"}</button>;
}
