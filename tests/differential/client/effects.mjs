// Effects, mount, window events, updater setters, shared state and withSyncEvent handlers.
export default async function (fake) {
  const s = fake.stores.get("clients/Effects");
  const context = { n: 0, seen: 0, width: 0, step: 5, tag: "unmeasured" };
  const out = {};
  await fake.within(context, () => s.callbacks.mount2());
  out.mounted = context.width;
  await fake.within(context, () => s.actions.add());
  await fake.within(context, () => s.actions.add());
  out.n = context.n;
  out.items = s.state.cart.items;
  out.shown = await fake.within(context, () => s.state.value1);
  await fake.within(context, () => s.callbacks.effect1());
  out.seen = context.seen;
  globalThis.window = { innerWidth: 777 };
  await fake.within(context, () => s.actions.onResize3());
  out.width = context.width;
  let prevented = false;
  await fake.within(context, () => s.actions.submit({ preventDefault() { prevented = true; } }));
  out.submitted = { n: context.n, prevented };
  // `ref={box}`: the handler's element finds the component root, then the element the ref names.
  // One of the same name inside a nested client component belongs to that component.
  const root = { matches: () => false, closest: () => root };
  const nested = { tagName: "NESTED", closest: () => ({}) };
  const output = { tagName: "OUTPUT", closest: () => root };
  const asked = [];
  root.querySelectorAll = (selector) => { asked.push(selector); return [nested, output]; };
  await fake.within(context, () => s.actions.measure(), { closest: () => root });
  out.ref = { tag: context.tag, asked };
  await fake.within(context, () => s.actions.measure(), { closest: () => null });
  out.detached = context.tag;
  return out;
}
