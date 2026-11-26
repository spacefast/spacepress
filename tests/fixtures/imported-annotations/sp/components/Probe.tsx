import { NAMES } from "./shadow";
import { word } from "./destructured";
import { card } from "./styled";

export function Probe() {
  const n: number = NAMES.a;
  return <p style={card}>{n + 1}:{word.toUpperCase()}</p>;
}
