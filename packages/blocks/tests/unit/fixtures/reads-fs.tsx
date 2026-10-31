import { readFileSync } from "node:fs";

export default function ReadsFs() {
  return <p>{readFileSync("/etc/hostname", "utf8")}</p>;
}
