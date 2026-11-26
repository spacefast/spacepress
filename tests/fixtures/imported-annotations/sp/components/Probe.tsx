import { NAMES } from "./shadow";
import { NAMES as FIRST } from "./shadow-first";
import { V } from "./stars";
import D from "./default-own";
import { word } from "./destructured";
import { card } from "./styled";

export function Probe() {
  const n: number = NAMES.a;
  const f: number = FIRST.a;
  const v: string = V.a ?? "";
  const d: number = D.a;
  return (
    <p style={card}>
      {n + f + d}:{word.toUpperCase()}:{v.length}
    </p>
  );
}
