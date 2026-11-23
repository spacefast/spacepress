// The LikeButton store: an async handler is a generator, `busy` is set around the action call, and
// the call is the app's typed client running the `like` action as its Ability: off WordPress (no
// `wp.apiFetch` here) a POST to core's run route with `{ input }`.
export default async function (fake) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => "142" };
  };
  const s = fake.stores.get("clients/LikeButton");
  const context = { count: 1, busy: false, postId: 42 };
  const label1 = await fake.within(context, () => s.state.label);
  const busyDuring = [];
  const pending = fake.within(context, () => { const p = s.actions.click1(); busyDuring.push(context.busy); return p; });
  await pending;
  const label2 = await fake.within(context, () => s.state.label);
  return { label1, busyDuring, after: context, label2, calls };
}
