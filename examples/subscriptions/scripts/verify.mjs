// Real HTTP proof. Use only a disposable account/site: this script creates and deletes fixtures.
import assert from "node:assert/strict";
const site = (process.env.TP_SITE ?? "http://localhost:8794").replace(/\/$/, "");
assert.ok(process.env.TP_APP_PASSWORD, "Set TP_APP_PASSWORD to username:application-password");
const authorization = `Basic ${Buffer.from(process.env.TP_APP_PASSWORD).toString("base64")}`;
const run = `subscription-proof-${Date.now()}`;
const owned = [];
async function api(method, path, data, extra = {}, expected) {
  const response = await fetch(`${site}/__tp/api/v1${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: authorization, ...extra },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await response.json();
  console.log(JSON.stringify({ method, path, status: response.status, body }));
  if (expected) assert.equal(response.status, expected);
  else assert.ok(response.ok, JSON.stringify(body));
  return body.data;
}
try {
  const category = await api("POST", "/categories", { name: run });
  owned.push(["categories", category.id]);
  const row = await api("POST", "/subscriptions", {
    name: run, amount: 12000, currency: "USD", cycle: "yearly", category: run,
    nextRenewal: new Date().toISOString().slice(0, 10), cancelUrl: "https://example.com/cancel",
  });
  owned.push(["subscriptions", row.id]);
  const read = await api("GET", `/subscriptions/${row.id}`);
  assert.equal(read.name, run);
  const edited = await api("PATCH", `/subscriptions/${row.id}`, { vendor: "Example" });
  assert.equal(edited.vendor, "Example");
  const burn = await api("POST", "/actions/monthlyBurn", {});
  assert.ok(burn.currencies.some((currency) => currency.currency === "USD" && currency.categories.some((entry) => entry.category === run && entry.amount === 1000)));
  const soon = await api("POST", "/actions/renewingSoon", { days: 3 });
  assert.ok(soon.some((entry) => entry.id === row.id));
  const charge = await api("POST", "/actions/logCharge", { subscriptionId: row.id }, { "Idempotency-Key": run });
  assert.equal(charge.charge.amount, 12000);
  assert.notEqual(charge.subscription.nextRenewal, row.nextRenewal);
  const again = await api("POST", "/actions/logCharge", { subscriptionId: row.id }, { "Idempotency-Key": run });
  assert.deepEqual(again, charge);
  const history = await api("GET", `/charges?where=${encodeURIComponent(JSON.stringify({ subscriptionId: row.id }))}`);
  assert.equal(history.length, 1);
  const cancelled = await api("POST", "/actions/cancel", { subscriptionId: row.id });
  assert.equal(cancelled.subscription.status, "cancelled");
  assert.equal(cancelled.cancelUrl, "https://example.com/cancel");
  await api("POST", "/actions/logCharge", { subscriptionId: row.id }, {}, 409);
  await api("POST", "/subscriptions", { name: "spoof", ownerId: 9999, amount: 100, nextRenewal: "2028-01-01" }, {}, 403);
  console.log("PASS: collection CRUD, all actions, charge history, idempotency, inactive-charge and owner-input rejection");
} finally {
  for (const [table, id] of owned.reverse()) await api("DELETE", `/${table}/${id}`);
}
