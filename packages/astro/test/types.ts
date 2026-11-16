// The declarations type-check against Astro's own loader types (tsc -p packages/astro).
import type { Loader, LiveLoader } from "astro/loaders";
import { tpLiveLoader, tpLoader, tpWebhook, verifySignature, type TypedPressWebhookEvent } from "../src/index.js";

const build: Loader = tpLoader("posts", { where: { featured: true }, with: { author: true }, pageSize: 50, id: (row) => String(row.id) });
const live: LiveLoader = tpLiveLoader("posts", { rendered: "always" });
const any = tpLiveLoader({ site: "https://example.com" });
any.loadEntry({ filter: { kind: "posts", id: "hello" }, collection: "first" });
export const POST = tpWebhook({ onEvent: ({ tags, event }: { tags: string[]; event: TypedPressWebhookEvent }) => void [tags, event.collection] });
const ok: Promise<boolean> = verifySignature("s", null, "{}");
void [build, live, ok];
// @ts-expect-error a kind is a string
tpLoader(42);

import { tpEmdash } from "@typedpress/astro/emdash";
import type { AstroIntegration } from "astro";
const emdash: AstroIntegration = tpEmdash({ pagesAt: "/" });
void emdash;
