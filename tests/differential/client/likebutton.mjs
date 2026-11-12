// The LikeButton store: an async handler is a generator, `busy` is set around the action call,
// and the call is a fetch to the action's endpoint with the REST nonce from getConfig().
export default async function (fake) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, nonce: init.headers["x-wp-nonce"], body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ data: 142 }) };
  };
  fake.setConfig("clients/LikeButton", { actions: { like: "/wp-json/first/v1/actions/like" }, nonce: "n0nce" });
  const s = fake.stores.get("clients/LikeButton");
  const context = { count: 1, busy: false, postId: 42 };
  const label1 = await fake.within(context, () => s.state.label);
  const busyDuring = [];
  const pending = fake.within(context, () => { const p = s.actions.click1(); busyDuring.push(context.busy); return p; });
  await pending;
  const label2 = await fake.within(context, () => s.state.label);
  return { label1, busyDuring, after: context, label2, calls };
}
