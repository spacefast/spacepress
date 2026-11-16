// A comment and another directive may come before "use client": it still marks a client component.
"use strict";
"use client";
import { useState } from "typedpress/client";
import styles from "./toggle.module.css";

export function Toggle() {
  const [on, setOn] = useState(false);
  return <button className={on ? styles.on : styles.off} onClick={() => setOn(!on)}>{on ? "on" : "off"}</button>;
}
