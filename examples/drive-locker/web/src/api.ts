import { createClient, ZeroError, type Collections, type Actions } from "../../zero/client/index.ts";

export const zero = createClient({
  url: "/wp-json/zero/v1",
  auth: {
    clientId: "app_drive_locker",
    redirectUri: location.origin + location.pathname,
    storage: "session",
  },
});

export type Drive = Collections["drives"]["row"];
export type Place = Collections["places"]["row"];
export type Reading = Collections["healthReadings"]["row"];
export type Content = Collections["contents"]["row"];
export type Capacity = Actions["capacityReport"]["output"];

export async function allRows<T>(read: (page: { limit: number; offset: number }) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await read({ limit: 100, offset });
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof ZeroError ? error.detail : error instanceof Error ? error.message : "Could not reach the server. Try again.";
}

export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function numberField(form: FormData, name: string): number {
  const value = field(form, name);
  const number = Number(value);
  if (!value || !Number.isFinite(number)) throw new Error(`Enter a number for ${name}.`);
  return number;
}

export function choice<T extends string>(value: string, options: readonly T[]): T {
  const selected = options.find((option) => option === value);
  if (selected === undefined) throw new Error("Choose an available option.");
  return selected;
}

export const driveKinds: readonly Drive["kind"][] = ["ssd", "hdd", "nvme", "sd", "usb"];
export const statuses: readonly Drive["status"][] = ["in-use", "spare", "failed", "retired"];
export const placeKinds: readonly Place["kind"][] = ["nas-bay", "desktop", "laptop", "drawer", "offsite"];
export const today = () => new Date().toISOString().slice(0, 10);
export const gb = (value: number) => `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} GB`;
