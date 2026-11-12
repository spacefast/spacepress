// Census tool tests. Every payload here is synthetic: the artifact is the committed fixture made by
// 0.8's own compiler (tests/fixtures/app-migrate/manifest), and the bundles are written by hand in
// the shape 0.8's esbuild step emits (whitespace removed, identifiers kept, `var x=capsule(...)`
// plus `export{x as default}`).
//
//   FIRST_BIN=target/debug/first node --test scripts/census-08/census.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { classify } from "./classify.mjs";
import { converterReport, outcome, payloadCensus, summarize, verifySource } from "./census.mjs";
import { ERASED, pageStub, PAGE_MARKER, serverSource, writeCapsule } from "./reconstruct.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const zero = path.resolve(process.env.FIRST_BIN ?? path.join(root, "target/debug/first"));
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/app-migrate/manifest/finalize.json"), "utf8"));

function typescript() {
  const require = createRequire(import.meta.url);
  try {
    return require("typescript");
  } catch {
    return require(path.join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "typescript"));
  }
}
const ts = typescript();

const bundle = (body) =>
  `import{capsule,mutation,query,string,table,endpoint,text}from"@spacefast/zero/server";${body}export{app_default as default};`;

function payload(body, artifact = {}) {
  return {
    artifact: { ...fixture.artifact, ...artifact },
    bundles: [{ path: "__spacefast/zero/bundles/server.qjs.mjs", contentBase64: Buffer.from(bundle(body)).toString("base64") }],
  };
}

function convert(finalize, users = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "census-test-"));
  try {
    writeCapsule(ts, finalize, path.join(dir, "app"));
    const args = ["migrate", "app", "--from", "zero-0.8", path.join(dir, "app"), "--out", path.join(dir, "out"), "--space", "spc_census", "--dry-run", "--json"];
    if (users) args.push("--users");
    const r = spawnSync(zero, args, { encoding: "utf8" });
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const labels = (report) => [...new Set(report.errors.map(classify).map((c) => `${c.kind}:${c.label}`))].sort();

test("the bundle becomes a default-exported capsule with class declarations and erased inputs", () => {
  const out = serverSource(
    ts,
    bundle('var Box=class _Box{static make(){return new _Box}};var app_default=capsule({name:"t",schema:{notes:table({body:string()})},mutations:{add:mutation(async(ctx,body)=>ctx.db.notes.insert({body}))}});'),
  );
  assert.match(out, /export default capsule\(/);
  assert.match(out, /class Box\{static make\(\)\{return new Box\}\}/);
  assert.match(out, new RegExp(`async\\(ctx,body: ${ERASED}\\)`));
  assert.doesNotMatch(out, /export\{/);
});

test("pages become stubs that only the source can fill", () => {
  assert.equal(pageStub({ file: "pages/notes/[id].tsx", render: "client" }, 0).text.startsWith('"use client";'), true);
  assert.match(pageStub({ file: "pages/about.tsx", render: "document" }, 0).text, new RegExp(PAGE_MARKER));
  assert.deepEqual(pageStub({ file: "content/pages/about.md", render: "document" }, 3), { file: "pages/census-document-3.md", text: "" });
  assert.equal(pageStub({ file: "../escape.tsx", render: "client" }, 0), null);
});

test("a client app without pages is refused only for what its client.js shows", () => {
  const clientJs = (text) => ({ ...fixture, staticFiles: [{ path: "client.js", contentBase64: Buffer.from(text).toString("base64") }] });
  // Without client.js, only the source can decide; with one using bridged hooks, nothing is refused.
  assert.deepEqual(payloadCensus(ts, fixture), { refusals: [], missing: ["client app body"] });
  assert.deepEqual(payloadCensus(ts, clientJs('import{useQuery,useMutation,Router}from"@spacefast/zero/client";')).refusals, []);
  assert.deepEqual(
    payloadCensus(ts, clientJs('import{storage}from"@spacefast/zero/client";import{Card}from"@spacefast/zero/kit";')).refusals,
    ["client: kit components", "client: storage uploads"],
  );
  // Packages, imports outside the capsule, dynamic imports and other 0.8 API, from client.js alone.
  assert.deepEqual(
    payloadCensus(ts, clientJs('import{useQuery,retryAuth2}from"@spacefast/zero/client";import x from"date-fns";import"../escape.js";const m=()=>import("./lazy.js");')).refusals.sort(),
    ["client: dynamic import", "client: import outside the capsule", "client: npm package", "client: other 0.8 client API"],
  );
  // A capsule with pages is not a client app.
  assert.deepEqual(payloadCensus(ts, { ...fixture, artifact: { ...fixture.artifact, pages: [{ file: "pages/index.tsx", render: "client" }] } }), { refusals: [], missing: [] });
  assert.deepEqual(outcome({ verified: false, report: { status: "dry-run", errors: [] }, census: [], missing: ["client app body"] }), {
    outcome: "not recoverable",
    refusals: [],
    missing: ["client app body"],
    codes: [],
  });
  // Each Space counts once per converter code, whatever the code's kind.
  const refused = outcome({ verified: false, report: { status: "refused", errors: [
    { pointer: "/queries/q/ctx/auth/userId", reason: "ctx.auth.userId maps only for Space Users (pass --users)", code: "Z08_CTX_AUTH_USERS" },
    { pointer: "/queries/r/ctx/auth/userId", reason: "ctx.auth.userId maps only for Space Users (pass --users)", code: "Z08_CTX_AUTH_USERS" },
  ] }, census: [] });
  assert.deepEqual(refused.codes, ["Z08_CTX_AUTH_USERS"]);
  assert.deepEqual(summarize("x", [refused, refused]).codes, [{ code: "Z08_CTX_AUTH_USERS", spaces: 2 }]);
});

test("the converter's client refusals classify as client reasons, not bundle shape", () => {
  for (const [reason, label] of [
    ["0.8 client storage uploads: `storage` from @spacefast/zero/client", "client: storage uploads"],
    ["npm package in the client: date-fns", "client: npm package"],
    ["client import outside the capsule: ../x", "client: import outside the capsule"],
    ["dynamic import in the client: import()", "client: dynamic import"],
    ["0.8 authenticatedFetch: `authenticatedFetch` from @spacefast/zero/client", "client: authenticatedFetch"],
    ["client app over an existing public/: the converted client app goes to public/", "client: existing public/"],
  ]) {
    assert.deepEqual(classify({ pointer: "/client/index.tsx", reason }), { label, kind: "refusal" }, reason);
  }
});

test("only verified source can be accepted", () => {
  const clean = { status: "dry-run", errors: [] };
  assert.equal(outcome({ verified: false, report: clean, census: [] }).outcome, "not recoverable");
  assert.equal(outcome({ verified: true, report: clean, census: [] }).outcome, "accepted");
  assert.equal(outcome({ verified: true, report: clean, census: ["x"] }).outcome, "refused");
  const erased = { status: "refused", errors: [{ pointer: "", reason: "generated application refused by v2 compiler: error: this argument is unknown, but the function expects string" }] };
  assert.deepEqual(outcome({ verified: false, report: erased, census: [] }), { outcome: "not recoverable", refusals: [], missing: ["erased parameter types"] });
});

test("a crashed or truncated converter run is a tool failure, not a census outcome", () => {
  const refused = { status: "refused", errors: [{ pointer: "/source", reason: "source not recoverable: x" }] };
  const text = JSON.stringify(refused);
  assert.deepEqual(converterReport({ code: 1, signal: null, stdout: text }), refused);
  assert.deepEqual(converterReport({ code: 0, signal: null, stdout: '{"status":"dry-run","errors":[]}' }).status, "dry-run");
  // A panic (exit 101), a kill, empty output, output cut off mid-report, and a status the exit contradicts.
  assert.equal(converterReport({ code: 101, signal: null, stdout: "" }), null);
  assert.equal(converterReport({ code: null, signal: "SIGKILL", stdout: text }), null);
  assert.equal(converterReport({ code: 1, signal: null, stdout: "" }), null);
  assert.equal(converterReport({ code: 1, signal: null, stdout: text.slice(0, -10) }), null);
  assert.equal(converterReport({ code: 0, signal: null, stdout: text }), null);
  assert.equal(converterReport({ code: 1, signal: null, stdout: '{"status":"refused","errors":[]}' }), null);
  assert.equal(converterReport({ code: 1, signal: null, stdout: "null" }), null);
});

test("source verification uses the recorded hashes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "census-src-"));
  try {
    fs.mkdirSync(path.join(dir, "server"));
    const text = "export default 1;\n";
    fs.writeFileSync(path.join(dir, "server/index.ts"), text);
    const sha256 = createHash("sha256").update(text).digest("hex");
    const artifact = { sourceManifest: { files: [{ path: "server/index.ts", sha256 }] } };
    assert.equal(verifySource(artifact, dir), true);
    fs.writeFileSync(path.join(dir, "server/index.ts"), "changed\n");
    assert.equal(verifySource(artifact, dir), false);
    assert.equal(verifySource({ sourceManifest: { files: [{ path: "../x", sha256 }] } }, dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// With FIRST_BIN set (as in CI) a missing binary fails the test instead of skipping it.
const skipConverter = !process.env.FIRST_BIN && !fs.existsSync(zero) && "no zero binary; run cargo build";
test("the converter's refusals on a rebuilt capsule keep their reasons", { skip: skipConverter }, () => {
  // A blocker the bundle shows: a context service the converter does not map.
  const services = convert(payload('var app_default=capsule({name:"t",schema:{notes:table({body:string()})},mutations:{add:mutation(async(ctx,body)=>{await ctx.jwt.sign({sub:body});return ctx.db.notes.insert({body})})}});', { pages: [] }));
  assert.ok(labels(services).includes("refusal:ctx.jwt"), labels(services).join());

  // A language construct outside the v2 subset, in a copied helper.
  const language = convert(payload('function pick(o){with(o){return a}}var app_default=capsule({name:"t",schema:{notes:table({body:string()})},queries:{n:query(async ctx=>String(pick({a:1})))}});', { pages: [] }));
  assert.ok(labels(language).includes("refusal:language: other construct"), labels(language).join());

  // An erased input is not a refusal: only the source can say what it was.
  const erased = convert(payload('var app_default=capsule({name:"t",schema:{notes:table({body:string()})},mutations:{add:mutation(async(ctx,body)=>ctx.db.notes.insert({body}))}});', { pages: [] }));
  assert.deepEqual(labels(erased), ["source:erased parameter types"]);

  // Pages: a client page needs its body, a Markdown page has no v2 counterpart.
  const pages = convert(
    payload('var app_default=capsule({name:"t",schema:{notes:table({body:string()})}});', {
      pages: [
        { id: "a", file: "pages/index.tsx", path: "/", render: "client", params: [] },
        { id: "b", file: "pages/about.md", path: "/about", render: "document", params: [] },
      ],
    }),
  );
  assert.deepEqual(labels(pages), ["refusal:pages: Markdown or HTML document", "source:page body"]);
});
