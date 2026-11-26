import { LABELS as DIRECT } from "./labels";
import { ALIASED, LABELS } from "./barrel";

export function Label({ name }: { name: string }) {
  return <span>{DIRECT[name] ?? LABELS[name] ?? ALIASED[name] ?? name}</span>;
}
