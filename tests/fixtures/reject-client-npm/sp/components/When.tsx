"use client";
import dayjs from "dayjs";
export function When() {
  return <time>{String(dayjs)}</time>;
}
