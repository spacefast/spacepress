// Destructuring-assignment shapes from live 0.8 apps: a running min/max and reassigning fields.
export function range(values: number[]): number[] {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    [low, high] = [Math.min(low, value), Math.max(high, value)];
  }
  return [low, high];
}

export function split(input: { title: string; note?: string }): string[] {
  let title = "";
  let note = "";
  ({ title, note = "" } = input);
  return [title, note];
}
