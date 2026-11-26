// The Loops store: loops, labels and `switch` in a plain handler, and an async handler (a
// generator) whose nested async callback awaits browser APIs and sets page properties.
export default async function (fake) {
  const s = fake.stores.get("clients/Loops");
  const context = { items: [2, 5, -1], total: 0, kind: "none", copied: "-" };
  await fake.within(context, () => s.actions.sum());
  const summed = { total: context.total, kind: context.kind };
  const fetched = [];
  const written = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return { json: async () => [{ href: "/docs/next" }] };
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (text) => { written.push(text); } } },
  });
  globalThis.document = { title: "" };
  globalThis.window = { location: { href: "/" } };
  await fake.within(context, () => s.actions.onKeydown1({ key: "k" }));
  return {
    summed,
    fetched,
    written,
    title: globalThis.document.title,
    copied: context.copied,
    href: globalThis.window.location.href,
  };
}
