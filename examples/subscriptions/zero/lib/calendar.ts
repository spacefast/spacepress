export type Cycle = "weekly" | "monthly" | "yearly";

// Date-only renewals use calendar months, clamped to the last day of the target month.
export function advanceRenewal(day: string, cycle: Cycle): string {
  if (cycle === "weekly") {
    return new Date(new Date(day).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  }
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const nextMonth = cycle === "yearly" ? month : month === 12 ? 1 : month + 1;
  const nextYear = cycle === "yearly" || month === 12 ? year + 1 : year;
  const leap = nextYear % 4 === 0 && (nextYear % 100 !== 0 || nextYear % 400 === 0);
  const days = nextMonth === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(nextMonth) ? 30 : 31;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(date, days)).padStart(2, "0")}`;
}

export function monthlyAmount(amount: number, cycle: Cycle): number {
  return cycle === "weekly" ? amount * 52 / 12 : cycle === "yearly" ? amount / 12 : amount;
}
