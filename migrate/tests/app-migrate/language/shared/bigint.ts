// BigInt shapes from live 0.8 apps: exact 64-bit ids and money in minor units.
export function nextId(last: string): string {
  return String(BigInt(last) + 1n);
}

export function totalCents(prices: number[]): string {
  let total = 0n;
  for (const price of prices) total += BigInt(Math.round(price * 100));
  return `${total / 100n}.${String(total % 100n).padStart(2, "0")}`;
}
