// The Relay store: handlers that call each other. An awaited handler gives its answer back, a plain
// one its value at once, and a callback that starts an async handler does not wait for it.
export default async function (fake) {
  globalThis.window = { Promise };
  const s = fake.stores.get("clients/Relay");
  const context = { total: 0, steps: "start", loaded: 0, shown: "unseen", base: 5 };
  const out = {};
  out.twice = await fake.within(context, () => s.actions.twice(4));
  // The mount callback starts `load` and returns before it has finished.
  const mounted = fake.within(context, () => s.callbacks.mount1());
  out.loadedAtMount = context.loaded;
  await mounted;
  await fake.settled();
  out.loaded = context.loaded;
  // `run` awaits `later` for its answer and doubles it with `twice`, whose value it uses at once:
  // a promise of it would make the total NaN.
  await fake.within(context, () => s.actions.run());
  out.total = context.total;
  out.steps = context.steps;
  await fake.within(context, () => s.actions.show());
  out.shown = context.shown;
  return out;
}
