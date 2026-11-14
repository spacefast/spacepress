// The declarations type-check against Astro's own loader types (tsc -p packages/astro).
import type { Loader, LiveLoader } from "astro/loaders";
import { firstLiveLoader, firstLoader, firstWebhook, verifySignature, type FirstWebhookEvent } from "../src/index.js";

const build: Loader = firstLoader("posts", { where: { featured: true }, with: { author: true }, pageSize: 50, id: (row) => String(row.id) });
const live: LiveLoader = firstLiveLoader("posts", { rendered: "always" });
const any = firstLiveLoader({ site: "https://example.com" });
any.loadEntry({ filter: { kind: "posts", id: "hello" }, collection: "first" });
export const POST = firstWebhook({ onEvent: ({ tags, event }: { tags: string[]; event: FirstWebhookEvent }) => void [tags, event.collection] });
const ok: Promise<boolean> = verifySignature("s", null, "{}");
void [build, live, ok];
// @ts-expect-error a kind is a string
firstLoader(42);

import { firstEmdash } from "@first/astro/emdash";
import type { AstroIntegration } from "astro";
const emdash: AstroIntegration = firstEmdash({ pagesAt: "/" });
void emdash;
