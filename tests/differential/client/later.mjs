// The Later store: callbacks that run after the handler returns (timers, a listener, promise
// callbacks) read a derived value, a ref and another handler through the handler's scope, and
// handlers call each other, sync and async. The fake runtime throws, as the real one does, when
// `getContext()` or `getElement()` runs with no scope.
export default async function (fake) {
  const s = fake.stores.get("clients/Later");
  const context = { items: [2, 5, -1], n: 1, log: "-" };
  const listeners = new Map();
  globalThis.document = {
    body: {
      addEventListener: (type, fn) => listeners.set(type, fn),
      dispatchEvent: (event) => listeners.get(event.type)?.(event),
    },
  };
  globalThis.Event ??= class { constructor(type) { this.type = type; } };
  const button = { tagName: "BUTTON", matches: () => true };
  button.closest = () => button;
  await fake.within(context, () => s.actions.run(), button);
  return { log: context.log, n: context.n };
}
