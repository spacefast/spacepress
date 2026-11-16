import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Run against this example's disposable Studio site. Passwords stay in memory.
const project = fileURLToPath(new URL("./", import.meta.url));
const binary = process.env.TP_BIN || fileURLToPath(new URL("../../target/release/typedpress", import.meta.url));
const base = process.env.TP_TEST_URL || "http://localhost:8796";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error("This runner only mutates a local disposable Studio site.");
const wp = (...args) => execFileSync(binary, ["wp", "--site", project, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const run = `locker-${Date.now()}`;
const credentials = [];
const created = [];

function auth(user) {
  const password = wp("user", "application-password", "create", user, run, "--porcelain").split("\n").at(-1);
  assert.ok(password);
  credentials.push(user);
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

async function request(label, path, { authorization, method = "GET", body, status = 200 } = {}) {
  // The app's API lives at /__tp/api/v1; everything else (the MCP adapter) under /wp-json.
  path = path.replace(/^tp\/v1\/?/, "__tp/api/v1/");
  const url = path.startsWith("__tp/") ? `${base}/${path}` : `${base}/wp-json/${path}`;
  const response = await fetch(url, {
    method, headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  console.log(`${label}: ${method} ${new URL(url).pathname} -> ${response.status} ${JSON.stringify(result)}`);
  if (Array.isArray(status)) assert.ok(status.includes(response.status), label);
  else assert.equal(response.status, status, label);
  return result.data;
}

let first;
try {
  try { wp("user", "get", "locker-other", "--field=ID"); }
  catch { wp("user", "create", "locker-other", "locker-other@example.test", "--role=subscriber", "--porcelain"); }
  first = auth("admin");
  const second = auth("locker-other");
  await request("Anonymous read blocked", "tp/v1/drives", { status: [401, 403] });
  await request("Anonymous action blocked", "tp/v1/actions/capacityReport", { method: "POST", body: {}, status: [401, 403] });
  const place = await request("Place create", "tp/v1/places", { authorization: first, method: "POST", status: 201, body: { name: run, kind: "nas-bay" } });
  created.push(["places", place.id]);
  const driveInput = { label: run, model: "Example NVMe", serial: run, kind: "nvme", capacityGb: 1000, interface: "PCIe 4.0", placeId: place.id, status: "in-use", tags: ["verification"], warrantyUntil: new Date().toISOString().slice(0, 10) };
  const drive = await request("Drive create", "tp/v1/drives", { authorization: first, method: "POST", status: 201, body: driveInput });
  created.push(["drives", drive.id]);
  await request("Drive edit", `tp/v1/drives/${drive.id}`, { authorization: first, method: "PATCH", body: { label: `${run} edited` } });
  assert.equal(drive.serial, run.toUpperCase());
  const duplicate = await fetch(`${base}/__tp/api/v1/drives`, { method: "POST", headers: { Authorization: first, "Content-Type": "application/json" }, body: JSON.stringify(driveInput) });
  console.log(`Duplicate serial: POST /__tp/api/v1/drives -> ${duplicate.status} ${await duplicate.text()}`);
  assert.equal(duplicate.status, 409);
  const other = await request("Same serial allowed for another owner", "tp/v1/drives", { authorization: second, method: "POST", status: 201, body: { ...driveInput, placeId: null } });
  assert.notEqual(other.ownerId, drive.ownerId);
  await request("Owner cannot be supplied", "tp/v1/places", { authorization: first, method: "POST", status: [403, 422], body: { name: run, kind: "drawer", ownerId: 999999 } });
  const hidden = await request("Other owner list", "tp/v1/drives", { authorization: second });
  assert.equal(hidden.some((row) => row.id === drive.id), false);
  await request("Other owner cannot update", `tp/v1/drives/${drive.id}`, { authorization: second, method: "PATCH", status: [403, 404], body: { label: "stolen" } });
  await request("Other owner cannot relate", "tp/v1/contents", { authorization: second, method: "POST", status: [404, 409], body: { driveId: drive.id, description: "stolen", usedGb: 1 } });
  await request("Other owner cannot move into place", "tp/v1/drives", { authorization: second, method: "POST", status: [403, 404, 409], body: { ...driveInput, serial: `${run}-other` } });
  const content = await request("Contents create", "tp/v1/contents", { authorization: first, method: "POST", status: 201, body: { driveId: drive.id, description: `${run} photos`, usedGb: 240, lastBackupOn: "2026-11-01" } });
  const contentRead = await request("Contents read", `tp/v1/contents/${content.id}`, { authorization: first });
  assert.equal(contentRead.usedGb, 240);
  const found = await request("whereIs contents search", "tp/v1/actions/whereIs", { authorization: first, method: "POST", body: { query: `${run} photos` } });
  assert.equal(found[0].place.id, place.id);
  assert.equal(found[0].drive.id, drive.id);
  const report = await request("capacityReport", "tp/v1/actions/capacityReport", { authorization: first, method: "POST", body: {} });
  const location = report.byPlace.find((row) => row.placeId === place.id);
  assert.deepEqual({ totalGb: location.totalGb, usedGb: location.usedGb, freeGb: location.freeGb }, { totalGb: 1000, usedGb: 240, freeGb: 760 });
  await request("Over-capacity rejected", "tp/v1/contents", { authorization: first, method: "POST", status: 422, body: { driveId: drive.id, description: "too much", usedGb: 761 } });
  await request("Capacity shrink rejected", `tp/v1/drives/${drive.id}`, { authorization: first, method: "PATCH", status: [403, 422], body: { capacityGb: 239 } });
  const warranty = await request("warrantyExpiring", "tp/v1/actions/warrantyExpiring", { authorization: first, method: "POST", body: { days: 0 } });
  assert.ok(warranty.some((row) => row.id === drive.id));
  const metrics = { driveId: drive.id, powerOnHours: 1000, reallocatedSectors: 0, wearPercent: 10, tempC: 35 };
  for (const [readOn, wearPercent, expected] of [["2026-11-01", 10, "ok"], ["2026-11-02", 13, "watch"], ["2026-11-03", 23, "replace"]]) {
    const result = await request(`logHealth ${expected}`, "tp/v1/actions/logHealth", { authorization: first, method: "POST", body: { ...metrics, readOn, wearPercent } });
    assert.equal(result.verdict, expected);
  }
  await request("Backdated health rejected", "tp/v1/actions/logHealth", { authorization: first, method: "POST", status: 422, body: { ...metrics, readOn: "2026-11-02" } });
  await request("Counter reset rejected", "tp/v1/actions/logHealth", { authorization: first, method: "POST", status: 422, body: { ...metrics, readOn: "2026-11-04" } });
  await request("Other owner cannot log", "tp/v1/actions/logHealth", { authorization: second, method: "POST", status: 404, body: { ...metrics, readOn: "2026-11-04" } });
  console.log(`Action Scheduler: ${wp("action-scheduler", "run", "--force")}`);
  const stamped = await request("Replacement stamp", `tp/v1/drives/${drive.id}`, { authorization: first });
  assert.ok(stamped.replacementNeededAt);
  const retired = await request("retire", "tp/v1/actions/retire", { authorization: first, method: "POST", body: { driveId: drive.id } });
  assert.equal(retired.status, "retired");
  await request("Other owner cannot retire", "tp/v1/actions/retire", { authorization: second, method: "POST", status: 404, body: { driveId: drive.id } });
  await request("Content update", `tp/v1/contents/${content.id}`, { authorization: first, method: "PATCH", body: { usedGb: 200 } });
  await request("Place update", `tp/v1/places/${place.id}`, { authorization: first, method: "PATCH", body: { name: `${run} updated` } });
  await request("MCP initialize", "mcp/typedpress-drive-locker", { authorization: first, method: "POST", body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "drive-locker-verifier", version: "1" } } } });
  await request("Content delete", `tp/v1/contents/${content.id}`, { authorization: first, method: "DELETE" });
  // Owner deletes of referenced rows, last: on main they answer 409 (#533).
  await request("Other owner deletes their own drive", `tp/v1/drives/${other.id}`, { authorization: second, method: "DELETE" });
  for (const [table, id] of created.reverse()) await request(`Delete ${table}`, `tp/v1/${table}/${id}`, { authorization: first, method: "DELETE" });
  created.length = 0;
  console.log("VERIFIED: drive CRUD over HTTP, all five actions, contents CRUD, two-owner isolation, trend verdicts, replacement job, MCP initialization and owner deletes with cascades.");
} finally {
  // A failed run leaves its rows; delete what is left as the owner and report a refusal.
  if (first) for (const [table, id] of created.reverse()) {
    const response = await fetch(`${base}/__tp/api/v1/${table}/${id}`, { method: "DELETE", headers: { Authorization: first } });
    console.log(`Cleanup: DELETE /__tp/api/v1/${table}/${id} -> ${response.status}`);
  }
  for (const user of credentials) {
    const entries = JSON.parse(wp("user", "application-password", "list", user, "--format=json"));
    for (const entry of entries.filter((entry) => entry.name === run)) wp("user", "application-password", "delete", user, entry.uuid);
  }
}
