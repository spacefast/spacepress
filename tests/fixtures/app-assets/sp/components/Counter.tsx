"use client";
import { useState } from "react";
import styles from "./counter.module.css";

export function Counter() {
  const [n, setN] = useState(0);
  return (
    <button className={n > 0 ? styles.on : styles.button} onClick={() => setN(n + 1)}>
      {n}
    </button>
  );
}
