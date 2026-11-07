// "php/wordpress" ability calls type-check against the generated Abilities map.
import { abilities } from "php/wordpress";

declare module "php/wordpress" {
  interface Abilities {
    "acme/site-info": { input: { field: "name" | "url" }; output: { value: string } };
    "acme/ping": { input: { loud?: boolean }; output: "pong" };
  }
}

export async function typed(): Promise<string> {
  const info = await abilities.call("acme/site-info", { field: "url" });
  const pong: "pong" = await abilities.call("acme/ping");
  return info.value + pong;
}

export async function refused(): Promise<void> {
  // @ts-expect-error an input value outside the schema's enum
  await abilities.call("acme/site-info", { field: "title" });
  // @ts-expect-error a required input is missing
  await abilities.call("acme/site-info");
  // @ts-expect-error not an ability the app knows
  await abilities.call("acme/unknown", {});
}
