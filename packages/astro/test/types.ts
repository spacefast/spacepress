// The declarations type-check against Astro's own loader types (tsc -p packages/astro).
import type { Loader, LiveLoader } from "astro/loaders";
import { spLiveLoader, spLoader, spWebhook, verifySignature, type SpacePressWebhookEvent } from "../src/index.js";

const build: Loader = spLoader("posts", { where: { featured: true }, with: { author: true }, pageSize: 50, id: (row) => String(row.id) });
const live: LiveLoader = spLiveLoader("posts", { rendered: "always" });
const any = spLiveLoader({ site: "https://example.com" });
any.loadEntry({ filter: { kind: "posts", id: "hello" }, collection: "first" });
export const POST = spWebhook({ onEvent: ({ tags, event }: { tags: string[]; event: SpacePressWebhookEvent }) => void [tags, event.collection] });
const ok: Promise<boolean> = verifySignature("s", null, "{}");
void [build, live, ok];
// @ts-expect-error a kind is a string
spLoader(42);

import { spEmdash } from "@spacepress/astro/emdash";
import type { AstroIntegration } from "astro";
const emdash: AstroIntegration = spEmdash({ pagesAt: "/" });
void emdash;
