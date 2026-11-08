const DAY_MS = 86_400_000;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return new Date(new Date(day + "T00:00:00.000Z").getTime() + days * DAY_MS)
    .toISOString().slice(0, 10);
}

export function overdueDelay(dueOn: string): number {
  return Math.max(0, (new Date(addDays(dueOn, 1) + "T00:00:00.000Z").getTime() - Date.now()) / 1000);
}
