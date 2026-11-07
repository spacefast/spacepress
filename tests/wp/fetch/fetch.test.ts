import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { api } from "../env.ts";

const port = process.env.ZERO_FETCH_PORT ?? "";
const log = process.env.ZERO_FETCH_LOG ?? "";
const origin = `https://fetch-origin.test:${port}`;

async function call(name: string, input: object): Promise<{ status: number; body: { data?: Record<string, unknown>; code?: string } }> {
  const response = await fetch(`${api}/actions/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}
const seen = (): { method: string; path: string; headers: Record<string, string>; body: string }[] =>
  readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("handlers fetch public HTTPS and read the response like a WHATWG Response", async () => {
  const json = await call("get", { url: `${origin}/json` });
  assert.equal(json.status, 200, JSON.stringify(json.body));
  assert.deepEqual(json.body.data, {
    status: 200, ok: true, url: `${origin}/json`, redirected: false, type: "application/json", origin: "ok",
    cookie: false, body: JSON.stringify({ hello: "world", method: "GET", received: "" }),
  });
  // A non-2xx answer is a response, not an error.
  const teapot = await call("get", { url: `${origin}/text` });
  assert.equal(teapot.body.data?.status, 418);
  assert.equal(teapot.body.data?.ok, false);
  assert.equal(teapot.body.data?.body, "short and stout");

  const posted = await call("post", { url: `${origin}/json`, payload: JSON.stringify({ n: 1 }) });
  assert.deepEqual(posted.body.data, { status: 200, data: { hello: "world", method: "POST", received: '{"n":1}' } });
  const request = seen().at(-1)!;
  assert.equal(request.headers["authorization"], "Bearer lane-token");
  // Hop-by-hop and Host headers are the transport's, never the handler's.
  assert.equal(request.headers["host"], `fetch-origin.test:${port}`);

  // Redirects are followed and re-checked; 303 becomes GET.
  const moved = await call("get", { url: `${origin}/redirect` });
  assert.deepEqual([moved.body.data?.status, moved.body.data?.redirected, moved.body.data?.url], [200, true, `${origin}/json`]);
  const other = await call("post", { url: `${origin}/see-other`, payload: "{}" });
  assert.equal((other.body.data?.data as { method: string }).method, "GET");
});

test("fetch refuses private targets, including through redirects, and bounds time and size", async () => {
  const refused = async (input: object, name = "get") => {
    const { status, body } = await call(name, input);
    assert.equal(status, 502, JSON.stringify(body));
    return body.code;
  };
  // Direct private and metadata addresses, and plain HTTP.
  assert.equal(await refused({ url: "https://127.0.0.1/" }), "zero_fetch_address_denied");
  assert.equal(await refused({ url: "https://169.254.169.254/latest/meta-data/" }), "zero_fetch_address_denied");
  assert.equal(await refused({ url: "https://[::1]/" }), "zero_fetch_address_denied");
  assert.equal(await refused({ url: "https://localhost/" }), "zero_fetch_host_denied");
  assert.equal(await refused({ url: `http://fetch-origin.test:${port}/json` }), "zero_fetch_scheme_denied");
  // The docker host gateway itself, by address: only the named lane origin is opened.
  assert.equal(await refused({ url: `https://host.docker.internal:${port}/json` }), "zero_fetch_address_denied");
  // A public origin that redirects inward is refused at the hop.
  const before = seen().length;
  assert.equal(await refused({ url: `${origin}/to-loopback` }), "zero_fetch_address_denied");
  assert.equal(await refused({ url: `${origin}/to-metadata` }), "zero_fetch_address_denied");
  assert.equal(await refused({ url: `${origin}/to-http` }), "zero_fetch_scheme_denied");
  assert.equal(await refused({ url: `${origin}/loop` }), "zero_fetch_too_many_redirects");
  // The loop made exactly four requests: the first and three redirects.
  assert.equal(seen().slice(before).filter((r) => r.path === "/loop").length, 4);
  assert.equal(await refused({ url: `${origin}/big` }), "zero_fetch_response_too_large");
  const started = Date.now();
  assert.equal(await refused({ url: `${origin}/slow` }), "zero_fetch_upstream_unavailable");
  assert.ok(Date.now() - started < 14000, "the 10 s budget ends the call before the origin answers");
});
