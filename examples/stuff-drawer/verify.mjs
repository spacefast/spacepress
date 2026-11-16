import assert from "node:assert/strict";

const site = process.env.TP_SITE?.replace(/\/$/, "");
const password = process.env.TP_APP_PASSWORD;
const otherPassword = process.env.TP_OTHER_APP_PASSWORD;
assert.ok(site && password, "Set TP_SITE and TP_APP_PASSWORD=user:application-password.");
const api = `${site}/__tp/api/v1`;

async function request(method, path, body, credential = password, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (credential) headers.Authorization = `Basic ${Buffer.from(credential).toString("base64")}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${api}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`${method} ${path}: HTTP ${response.status}, expected JSON: ${text.slice(0, 300)}`); }
  console.log(`${method} ${path} -> ${response.status} ${JSON.stringify(json)}`);
  return { status: response.status, json };
}

async function ok(method, path, body, credential = password, headers = {}) {
  const response = await request(method, path, body, credential, headers);
  assert.ok(response.status >= 200 && response.status < 300, `${method} ${path} failed`);
  assert.ok(Object.hasOwn(response.json, "data"), `${path} lacks a TypedPress response envelope`);
  return response.json.data;
}

async function problem(method, path, body, status, code, credential = password) {
  const response = await request(method, path, body, credential);
  assert.equal(response.status, status);
  assert.equal(response.json.code, code);
}

const action = (name, input, credential = password, headers = {}) =>
  ok("POST", `/actions/${name}`, input, credential, headers);
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

if (process.argv.includes("--stamps")) {
  const id = Number(process.env.TP_STAMP_LOAN_ID);
  assert.ok(Number.isSafeInteger(id) && id > 0, "Set TP_STAMP_LOAN_ID to the ID printed by the first run.");
  const loan = await ok("GET", `/loans/${id}`);
  assert.equal(loan.returnedOn, null);
  assert.ok(loan.dueOn < day(0));
  assert.equal(typeof loan.overdueAt, "string", "Run Action Scheduler before checking the stamp.");
  assert.ok(Number.isFinite(Date.parse(loan.overdueAt)));
  console.log("PASS: Action Scheduler stamped the open overdue loan.");
} else {
  const run = `${Date.now()}`;
  await problem("GET", "/bins", undefined, 401, "unauthenticated", null);
  await problem("POST", "/actions/find", { query: "cable" }, 401, "unauthenticated", null);

  const scratch = await ok("POST", "/bins", { name: `Disposable ${run}`, location: "Desk" });
  assert.equal(typeof scratch.ownerId, "number");
  const read = await ok("GET", `/bins/${scratch.id}`);
  assert.equal(read.name, scratch.name);
  const updated = await ok("PATCH", `/bins/${scratch.id}`, { location: "Cupboard" });
  assert.equal(updated.location, "Cupboard");
  const listed = await ok("GET", `/bins?where=${encodeURIComponent(JSON.stringify({ id: scratch.id }))}`);
  assert.ok(listed.some((row) => row.id === scratch.id));
  await problem("PATCH", `/bins/${scratch.id}`, { ownerId: scratch.ownerId + 1 }, 403, "forbidden");
  await problem("POST", "/bins", { name: "Forged owner", location: "Desk", ownerId: scratch.ownerId }, 403, "forbidden");
  await ok("DELETE", `/bins/${scratch.id}`);
  await problem("GET", `/bins/${scratch.id}`, undefined, 404, "not_found");

  const bin = await ok("POST", "/bins", { name: `Cable drawer ${run}`, location: "Hallway cupboard, top shelf" });
  const person = await ok("POST", "/people", { name: `Sam ${run}`, contact: "sam@example.test" });
  const thing = await ok("POST", "/things", {
    name: `USB-C to Lightning cable ${run}`, kind: "cable", connectorA: "USB-C", connectorB: "Lightning",
    lengthCm: 100, wattage: 20, binId: bin.id, quantity: 1, tags: ["travel", "iphone", run],
  });
  await problem("PATCH", `/things/${thing.id}`, { tags: { travel: true } }, 422, "invalid_input");
  for (const row of [bin, person, thing]) assert.equal(row.ownerId, bin.ownerId);
  for (const query of [`USB-C Lightning ${run}`, `travel iphone ${run}`, thing.name]) {
    const found = await action("find", { query });
    assert.equal(found.length, 1);
    assert.equal(found[0].thing.id, thing.id);
    assert.equal(found[0].bin.id, bin.id);
    assert.equal(found[0].outOnLoan, false);
    assert.equal(found[0].availableQuantity, 1);
  }
  assert.deepEqual(await action("find", { query: `no-such-thing-${run}` }), []);

  const input = { thingId: thing.id, personId: person.id, lentOn: day(-4), dueOn: day(-2) };
  await problem("POST", "/actions/lend", { ...input, dueOn: day(-5) }, 422, "invalid_input");
  const idempotency = { "Idempotency-Key": `stuff-drawer-${run}` };
  const loan = await action("lend", input, password, idempotency);
  const replay = await action("lend", input, password, idempotency);
  assert.equal(replay.id, loan.id);
  const borrowed = await action("find", { query: run });
  assert.equal(borrowed[0].outOnLoan, true);
  assert.equal(borrowed[0].availableQuantity, 0);
  await problem("POST", "/actions/lend", input, 409, "all_lent");
  const held = await action("whoHas", { personId: person.id });
  assert.ok(held.some((entry) => entry.loan.id === loan.id && entry.thing.id === thing.id && entry.person.id === person.id));
  const overdue = await action("overdue", {});
  assert.ok(overdue.some((entry) => entry.loan.id === loan.id));

  if (otherPassword) {
    for (const [resource, id] of [["bins", bin.id], ["things", thing.id], ["people", person.id], ["loans", loan.id]]) {
      await problem("GET", `/${resource}/${id}`, undefined, 404, "not_found", otherPassword);
      const foreignList = await ok("GET", `/${resource}?where=${encodeURIComponent(JSON.stringify({ id }))}`, undefined, otherPassword);
      assert.deepEqual(foreignList, []);
    }
    assert.deepEqual(await action("find", { query: run }, otherPassword), []);
    await problem("POST", "/actions/whoHas", { personId: person.id }, 404, "not_found", otherPassword);
    await problem("POST", "/actions/giveBack", { loanId: loan.id }, 404, "not_found", otherPassword);
    await problem("POST", "/actions/lend", input, 404, "not_found", otherPassword);
    await problem("POST", "/things", { name: `Foreign bin ${run}`, binId: bin.id }, 404, "not_found", otherPassword);
    console.log("PASS: a second WordPress user cannot read or lend another owner's rows.");
  } else {
    console.log("SKIP: cross-owner checks require TP_OTHER_APP_PASSWORD.");
  }

  await problem("POST", "/actions/giveBack", { loanId: loan.id, returnedOn: day(-5) }, 422, "invalid_input");
  const returned = await action("giveBack", { loanId: loan.id, returnedOn: day(-1) });
  assert.equal(returned.returnedOn, day(-1));
  const repeated = await action("giveBack", { loanId: loan.id, returnedOn: day(0) });
  assert.equal(repeated.returnedOn, day(-1));
  assert.ok(!(await action("overdue", {})).some((entry) => entry.loan.id === loan.id));
  assert.ok(!(await action("whoHas", { personId: person.id })).some((entry) => entry.loan.id === loan.id));
  const available = await action("find", { query: run });
  assert.equal(available[0].outOnLoan, false);
  assert.equal(available[0].availableQuantity, 1);

  const stampLoan = await action("lend", input);
  console.log(`TP_STAMP_LOAN_ID=${stampLoan.id}`);
  console.log(`Demo rows retained: bin=${bin.id}, thing=${thing.id}, person=${person.id}, loan=${stampLoan.id}`);
  console.log("PASS: collection CRUD, owner protection, all five actions, search, quantity exhaustion, lending replay, return replay, and overdue dates.");
  console.log("Run Action Scheduler, then rerun with --stamps and TP_STAMP_LOAN_ID to verify the stored stamp.");
}
