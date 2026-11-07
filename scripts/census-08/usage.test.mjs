// Usage catalog tests. Every input is synthetic: bundles are hand-written in the shape 0.8's
// esbuild steps emit, and the artifact is the committed fixture made by 0.8's own compiler.
//
//   node --test scripts/census-08/usage.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { clientBundleFacts, extract, serverFacts } from "./extract.mjs";
import { FEATURES, SECTIONS } from "./features.mjs";
import { catalog, INTERNAL, SUPPORT_THRESHOLD } from "./usage.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/app-migrate/manifest/finalize.json"), "utf8"));
const ts = (() => {
  const require = createRequire(import.meta.url);
  try {
    return require("typescript");
  } catch {
    return require(path.join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "typescript"));
  }
})();

const IMPORTS = 'import{capsule,endpoint,mutation,query,string,table,text,json,redirect,ImageResponse,verifyUser}from"@spacefast/zero/server";';
const server = (body) => serverFacts(ts, `${IMPORTS}${body}export{app_default as default};`);
const sorted = (set) => [...set].sort();

test("every capability-table section has features, and ids are unique", () => {
  for (const s of SECTIONS) assert.ok(FEATURES.some((f) => f.section === s), s);
  assert.equal(new Set(FEATURES.map((f) => f.id)).size, FEATURES.length);
});

test("ctx services, auth fields and db chains are read through helpers and aliases", () => {
  const f = server(
    'function audit(c,msg){c.log.info(msg);return c.crypto.sha256(msg)}' +
      'var app_default=capsule({name:"t",favicon:"/f.png",auth:{requireSignIn:true,onGuestUpgrade:async(ctx,u)=>ctx.db.notes.insert({body:u.userId})},' +
      'schema:{notes:table({body:string()})},' +
      'queries:{list:query(async(ctx,cursor)=>ctx.db.notes.withIndex("by_creation").order("desc").paginate({numItems:10,cursor}))},' +
      'mutations:{add:mutation(async(ctx,body)=>{const{userId}=ctx.auth;const db=ctx.db;await audit(ctx,body);await ctx.email.send({to:"a"});ctx.invalidate("list");return db.notes.insert({body})})},' +
      'endpoints:{hook:endpoint({method:"POST",path:"/hook"},async(ctx,request)=>{const raw=await request.bytes();const r=await fetch(request.url);return json({ok:ctx.auth.isSignedIn,n:raw.length,h:[...request.headers.entries()]})})}});',
  );
  assert.deepEqual(sorted(f.ctx), ["auth", "crypto", "db", "email", "invalidate", "log"]);
  assert.deepEqual(sorted(f.auth), ["isSignedIn", "userId"]);
  assert.ok(f.request.has("bytes") && f.request.has("url") && f.request.has("headers.entries"));
  assert.ok(f.globals.has("fetch"));
  assert.deepEqual(f.db, { crud: true, query: true, paginate: true, range: false });
  assert.ok(f.options.has("favicon") && f.authOptions.has("onGuestUpgrade"));
  assert.equal(f.ctxDynamic, false);
});

test("ctx stored or passed to something that is not a local helper is dynamic use", () => {
  assert.equal(server('var app_default=capsule({name:"t",queries:{q:query(async ctx=>globalThis.run(ctx))}});').ctxDynamic, true);
  assert.equal(server('var app_default=capsule({name:"t",queries:{q:query(async ctx=>ctx.env.A)}});').ctxDynamic, false);
});

test("a range on an optional field is told apart from one on a required field", () => {
  const body = (field) => `var app_default=capsule({name:"t",queries:{q:query(async ctx=>ctx.db.notes.withIndex("by_due",q=>q.gt("${field}",1)).collect())}});`;
  const optional = new Map([["notes", new Set(["due"])]]);
  assert.equal(serverFacts(ts, `${IMPORTS}${body("due")}export{app_default as default};`, optional).db.range, true);
  assert.equal(serverFacts(ts, `${IMPORTS}${body("rank")}export{app_default as default};`, optional).db.range, false);
});

test("client features come from the platform imports client.js leaves external", () => {
  const c = clientBundleFacts(
    ts,
    'import{useQuery,useMutation,Link,Router,Pages}from"@spacefast/zero/client";import{Button}from"@spacefast/zero/kit";import{useState}from"preact/hooks";import{jsx}from"preact/jsx-runtime";function x(){}',
  );
  assert.deepEqual(sorted(c.zero), ["Link", "Pages", "Router", "useMutation", "useQuery"]);
  assert.ok(c.modules.has("@spacefast/zero/kit"));
  assert.equal(c.preactHooks, true);
});

test("the fixture payload's facts drive artifact features, and client rows are unmeasured without client.js", () => {
  const facts = extract(ts, fixture);
  const hit = (id) => FEATURES.find((f) => f.id === id).detect(facts);
  assert.equal(hit("endpoint"), true);
  assert.equal(hit("endpoint-splat"), true);
  assert.equal(hit("endpoint-param"), true);
  assert.equal(hit("client-standalone"), true);
  assert.equal(hit("pages-client"), false);
  assert.equal(hit("hook-query"), null);
});

test("internal team rules and the support threshold", () => {
  const rule = (team, space = {}) => INTERNAL.find(([, t]) => t(team, space))?.[0] ?? null;
  assert.equal(rule({ slug: "suat-s-team", name: "Suat's Team" }), "Suat's Team (contractor)");
  assert.equal(rule({ slug: "batuhan", name: "batuhan" }), "batuhan team");
  assert.equal(rule({ slug: "x", name: "y", systemKey: "platform" }), "system team (system_key set)");
  assert.equal(rule({ slug: "uptime", name: "Ops" }, { slug: "checkly-probe" }), "Checkly monitoring");
  assert.equal(rule({ slug: "acme", name: "Acme Studio" }), null);
  const facts = extract(ts, { artifact: { format: "stattic.zero.capsule.v1", server: {} }, bundles: [] });
  facts.server.ctx.add("env");
  const spaces = ["a", "b", "c", "c", "x"].map((team) => ({
    team,
    internal: team === "x" ? "batuhan team" : null,
    traffic: team === "a" ? 5 : 0,
    facts,
  }));
  const row = catalog(spaces).find((r) => r.id === "ctx-env");
  assert.equal(row.spaces, 5);
  assert.equal(row.teams, 4);
  assert.equal(row.externalTeams, 3);
  assert.equal(row.activeSpaces, 1);
  assert.equal(row.decision, SUPPORT_THRESHOLD <= 3 ? "Support" : "Rewrite on v2");
  assert.equal(catalog(spaces, 4).find((r) => r.id === "ctx-env").decision, "Rewrite on v2");
});

test("the command reads a scratch export and prints counts only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-test-"));
  try {
    const bundle = `${IMPORTS}var app_default=capsule({name:"t",queries:{q:query(async ctx=>ctx.env.SECRET_NAME)}});export{app_default as default};`;
    for (const [i, team] of ["t1", "t2", "t3"].entries()) {
      const payload = { ...fixture, bundles: [{ contentBase64: Buffer.from(bundle).toString("base64") }] };
      fs.writeFileSync(path.join(dir, `ver_${i}.json`), JSON.stringify(payload));
      fs.appendFileSync(path.join(dir, "meta.tsv"), `ver_${i}\tspc_${i}\t${team}\tacme-${i}\tAcme ${i}\t\t\t\tsecret-space-${i}\n`);
      fs.appendFileSync(path.join(dir, "traffic-30d.tsv"), `spc_${i}\t${i}\n`);
    }
    const out = path.join(dir, "summary.json");
    const r = spawnSync(process.execPath, [path.join(root, "scripts/census-08/usage.mjs"), "--data", dir, "--json", out], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const summary = JSON.parse(fs.readFileSync(out, "utf8"));
    const env = summary.features.find((f) => f.id === "ctx-env");
    assert.deepEqual([env.spaces, env.teams, env.externalTeams, env.activeSpaces, env.decision], [3, 3, 3, 2, "Support"]);
    const text = r.stdout + fs.readFileSync(out, "utf8");
    for (const secret of ["SECRET_NAME", "Acme", "acme-", "secret-space", "spc_", "ver_"]) assert.ok(!text.includes(secret), secret);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
