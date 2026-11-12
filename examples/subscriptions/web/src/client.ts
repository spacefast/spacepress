import { createClient, type ClientOptions } from "../../first/_generated/client/index.ts";
import type { Collections } from "../../first/_generated/client/types.ts";

const page = new URL(window.location.pathname, window.location.origin);
const options = {
  url: "/__first/api/v1",
  auth: {
    clientId: import.meta.env.VITE_ZERO_APP_ID ?? "app_subscriptions",
    redirectUri: page.origin + page.pathname,
    storage: "session",
  },
} satisfies ClientOptions;

export const first = createClient(options);

export function logRenewal(
  subscription: Pick<Collections["subscriptions"]["row"], "id" | "nextRenewal">,
) {
  return createClient({
    ...options,
    headers: {
      "Idempotency-Key": `renewal-${subscription.id}-${subscription.nextRenewal}`,
    },
  }).actions.logCharge({ subscriptionId: subscription.id });
}
