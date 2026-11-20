import type { ReactLike } from "./react.ts";
import type { WooCartClient } from "./commerce.ts";
import { createCartStore, type WooCartActions, type WooCartState } from "./cart-store.ts";

export interface CartHooks {
  /** The current cart, its request state, and the actions for this cart client. */
  useCart(): WooCartState & WooCartActions;
  /** The optimistic item count. Undefined while the first cart loads. */
  useCartCount(): number | undefined;
}

/** Give the hooks your app's React 18+ and, optionally, its Woo cart client. */
export function createCartHooks(React: Pick<ReactLike, "useSyncExternalStore">, client?: WooCartClient): CartHooks {
  const store = createCartStore(client);
  const count = () => store.snapshot().cart?.itemsCount;
  return {
    useCart() {
      const state = React.useSyncExternalStore(store.subscribe, store.snapshot, store.serverSnapshot);
      return { ...state, ...store.actions };
    },
    useCartCount() {
      return React.useSyncExternalStore(store.subscribe, count, () => undefined);
    },
  };
}
