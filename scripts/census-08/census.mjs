#!/usr/bin/env node
// Census of live Zero 0.8 Spaces against `zero migrate app --from zero-0.8`.
//
//   node scripts/census-08/census.mjs --data <dir> --zero <label>=<binary> [--zero ...]
//        [--users] [--jobs N] [--json <summary.json>] [--per-space <detail.json>]
//
// <dir> holds one `<version_id>.json` per Space: the stored
// `stattic_versions.source_metadata_json -> 'statticZero' -> 'finalize'` of the Space's live
// version (docs/zero-08-parity.md has the export query). When the original source of a version is
// recovered, put it at `<dir>/sources/<version_id>/`; every file in the payload's
// `artifact.sourceManifest.files` must match its recorded SHA-256 there, or it is not used.
//
// For each Space and each binary, the outcome is exactly one of:
//   accepted        source recovered and verified, and the dry run exits 0 with status "dry-run"
//   refused         at least one converter error is a refusal (classify.mjs), from the source run
//                   or, without source, from the run over the capsule rebuilt from the payload
//   not recoverable no refusal, and no verified source: what remains needs the original source
// Every census rule beyond the converter's own errors is listed in RULES below.
//
// The summary printed to stdout and written by --json has counts only. --per-space writes version
// ids; keep that file with the data, never in a repository.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { classify, SOURCE_NOT_RECOVERABLE } from "./classify.mjs";
import { clientFacts } from "./extract.mjs";
import { writeCapsule } from "./reconstruct.mjs";

/** Census rules on the payload itself, applied before the converter runs. */
export const RULES = {
  // The source would draw `ImageResponse` with JSX, which the converter refuses on the server.
  // The bundle has that JSX compiled away, so the census reads the SDK import instead; esbuild
  // drops unused imports, so an imported `ImageResponse` is used.
  imageResponse: "ImageResponse (JSX on the server)",
};

function loadTypeScript() {
  const require = createRequire(import.meta.url);
  try {
    return require("typescript");
  } catch {
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return require(path.join(root, "typescript"));
  }
}

function args(argv) {
  const out = { zero: [], users: false, jobs: Math.max(1, Math.min(16, os.cpus().length)), data: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--data") out.data = next();
    else if (a === "--zero") {
      const v = next();
      const eq = v.indexOf("=");
      out.zero.push(eq > 0 ? { label: v.slice(0, eq), bin: v.slice(eq + 1) } : { label: path.basename(v), bin: v });
    } else if (a === "--users") out.users = true;
    else if (a === "--jobs") out.jobs = Number(next());
    else if (a === "--json") out.json = next();
    else if (a === "--per-space") out.perSpace = next();
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.data || out.zero.length === 0) {
    throw new Error("usage: census.mjs --data <dir> --zero <label>=<binary> [--zero ...] [--users] [--jobs N] [--json <file>] [--per-space <file>]");
  }
  return out;
}

/** True when every recorded source file is under `dir` with its recorded hash. */
export function verifySource(artifact, dir) {
  const files = artifact?.sourceManifest?.files ?? [];
  if (files.length === 0 || !fs.existsSync(dir)) return false;
  for (const f of files) {
    const rel = String(f.path ?? "");
    if (!rel || path.isAbsolute(rel) || rel.split("/").includes("..")) return false;
    let bytes;
    try {
      bytes = fs.readFileSync(path.join(dir, rel));
    } catch {
      return false;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== f.sha256) return false;
  }
  return true;
}

/**
 * A client app without pages (0.8 served `client/` as a single-page app when a capsule had no pages)
 * converts to v2 static files with a bridge for `@spacefast/zero/client` (src/config_migrate/app/client.rs).
 * Its body is not in the payload, so the census decides only what the uploaded `client.js` shows: the
 * platform modules it imports and the SDK names it uses. Each label matches a Z08_CLIENT_* code.
 */
export const CLIENT_RULES = [
  ["client: kit components", (c) => c.modules.has("@spacefast/zero/kit")],
  ["client: charts", (c) => c.modules.has("@spacefast/zero/charts") || c.modules.has("recharts")],
  ["client: storage uploads", (c) => c.zero.has("storage")],
  ["client: authenticatedFetch", (c) => c.zero.has("authenticatedFetch")],
  ["client: connector state", (c) => ["useConnectorState", "useConnectorRoleState", "retryConnectorQueries"].some((n) => c.zero.has(n))],
  ["client: content reads", (c) => c.zero.has("contentQueryOptions")],
  ["client: 0.8 sign-in", (c) => ["SignInWithGoogle", "SignInWithGravatar", "SignInWithSpacefast", "signInWithGoogle", "signInWithGravatar", "signInWithSpacefast", "getIdentity", "getCurrentUser", "retryAuth", "canAccessApp"].some((n) => c.zero.has(n))],
];

/** True for a capsule 0.8 served as a single-page client app. */
export function standaloneClient(artifact) {
  const files = new Set((artifact?.sourceManifest?.files ?? []).map((f) => f.path));
  const client = artifact?.sourceManifest?.entries?.client;
  return (artifact?.pages ?? []).length === 0 && Boolean(client) && files.has(client);
}

/**
 * What the payload decides before any converter runs: census-rule refusals, and what only the
 * source can settle. `ts` reads the uploaded `client.js` when the payload kept it.
 */
export function payloadCensus(ts, finalize) {
  const artifact = finalize?.artifact ?? finalize;
  const out = { refusals: [], missing: [] };
  if (!standaloneClient(artifact)) return out;
  const facts = clientFacts(ts, finalize, [], true);
  if (facts.measured) out.refusals.push(...CLIENT_RULES.filter(([, test]) => test(facts)).map(([label]) => label));
  out.missing.push("client app body");
  return out;
}

/**
 * A converter run's report, or null when the run is a tool failure: a signal or an exit code other
 * than 0 (written) and 1 (refused), output that is not one complete JSON report, or a status that
 * contradicts the exit code. A failure is never a census outcome; it invalidates the run.
 */
export function converterReport({ code, signal, stdout }) {
  if (signal || (code !== 0 && code !== 1)) return null;
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (report === null || typeof report !== "object" || !Array.isArray(report.errors)) return null;
  const ok = code === 0 ? report.status === "dry-run" && report.errors.length === 0 : report.status === "refused" && report.errors.length > 0;
  return ok ? report : null;
}

function run(bin, input, out, users) {
  const argv = ["migrate", "app", "--from", "zero-0.8", input, "--out", out, "--space", "spc_census", "--dry-run", "--json"];
  if (users) argv.push("--users");
  return new Promise((resolve) => {
    const child = spawn(bin, argv, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.resume();
    child.on("error", () => resolve({ code: null, signal: "spawn", stdout: "" }));
    child.on("close", (code, signal) => resolve({ code, signal, stdout }));
  });
}

/** One Space's outcome for one binary. */
export function outcome({ verified, report, census, missing: unrecorded = [] }) {
  const errors = (report?.errors ?? []).map(classify);
  const refusals = [...new Set([...census, ...errors.filter((e) => e.kind === "refusal").map((e) => e.label)])].sort();
  const missing = [...new Set(errors.filter((e) => e.kind === "source").map((e) => e.label))].sort();
  if (verified && report?.status === "dry-run" && census.length === 0) return { outcome: "accepted", refusals, missing };
  if (refusals.length > 0) return { outcome: "refused", refusals, missing };
  if (!verified) {
    const all = [...new Set([...missing, ...unrecorded])].sort();
    return { outcome: "not recoverable", refusals, missing: all.length ? all : ["stored payload only"] };
  }
  // Verified source whose only errors are source-kind still did not convert.
  return { outcome: "refused", refusals: ["converter error on recovered source"], missing };
}

async function pool(items, jobs, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

function rank(counter) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, spaces]) => ({ reason, spaces }));
}

export function summarize(label, perSpace) {
  const total = perSpace.length;
  const count = (o) => perSpace.filter((s) => s.outcome === o).length;
  const refusedBy = {};
  const missingBy = {};
  let onlyRefusal = {};
  for (const s of perSpace) {
    for (const r of s.refusals) refusedBy[r] = (refusedBy[r] ?? 0) + 1;
    if (s.refusals.length === 1) onlyRefusal[s.refusals[0]] = (onlyRefusal[s.refusals[0]] ?? 0) + 1;
    if (s.outcome === "not recoverable") for (const m of s.missing) missingBy[m] = (missingBy[m] ?? 0) + 1;
  }
  const share = (n) => Math.round((1000 * n) / total) / 10;
  const accepted = count("accepted");
  const refused = count("refused");
  const notRecoverable = count("not recoverable");
  return {
    binary: label,
    spaces: total,
    accepted,
    refused,
    notRecoverable,
    share: { accepted: share(accepted), refused: share(refused), notRecoverable: share(notRecoverable) },
    refusedBy: rank(refusedBy),
    soleRefusal: rank(onlyRefusal),
    notRecoverableBy: rank(missingBy),
  };
}

async function main() {
  const opts = args(process.argv.slice(2));
  const ts = loadTypeScript();
  const files = fs
    .readdirSync(opts.data)
    .filter((f) => /^ver_[A-Za-z0-9_-]+\.json$/.test(f))
    .sort();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "census-08-"));
  try {
    // Rebuild each capsule once; every binary reads the same input.
    const spaces = files.map((f, i) => {
      const version = f.slice(0, -5);
      const finalize = JSON.parse(fs.readFileSync(path.join(opts.data, f), "utf8"));
      const artifact = finalize.artifact ?? finalize;
      const source = path.join(opts.data, "sources", version);
      const verified = verifySource(artifact, source);
      const dir = path.join(scratch, `app-${i}`);
      const rebuilt = writeCapsule(ts, finalize, dir);
      const { refusals: census, missing } = payloadCensus(ts, finalize);
      if (rebuilt.imageResponse) census.push(RULES.imageResponse);
      return { version, verified, input: verified ? source : dir, census, missing };
    });
    const summaries = [];
    const detail = {};
    for (const { label, bin } of opts.zero) {
      const failures = [];
      const per = await pool(spaces, opts.jobs, async (s, i) => {
        const result = await run(bin, s.input, path.join(scratch, `out-${label}-${i}`), opts.users);
        const report = converterReport(result);
        if (report === null) {
          failures.push(`${s.version}: exit ${result.code ?? "none"}${result.signal ? ` signal ${result.signal}` : ""}`);
          return null;
        }
        return { version: s.version, verified: s.verified, ...outcome({ verified: s.verified, report, census: s.census, missing: s.missing }) };
      });
      // A crashing or truncating binary must not look like an improvement: stop instead of counting.
      if (failures.length > 0) {
        throw new Error(`${label}: the converter failed on ${failures.length} space(s); no census was counted\n  ${failures.sort().join("\n  ")}`);
      }
      summaries.push(summarize(label, per));
      detail[label] = per;
    }
    const result = {
      users: opts.users,
      formula: {
        accepted: "verified source and dry run exit 0 with status dry-run",
        refused: "at least one refusal-kind error (converter or census rule)",
        notRecoverable: `no refusal and no verified source (${SOURCE_NOT_RECOVERABLE})`,
        share: "count / spaces, one decimal",
      },
      sourcesVerified: spaces.filter((s) => s.verified).length,
      binaries: summaries,
    };
    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(result, null, 2));
    if (opts.perSpace) fs.writeFileSync(opts.perSpace, JSON.stringify(detail, null, 2), { mode: 0o600 });
    print(result);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function print(result) {
  console.log(`spaces with verified source: ${result.sourcesVerified}${result.users ? "  (--users)" : ""}`);
  for (const b of result.binaries) {
    console.log(`\n${b.binary}: ${b.spaces} spaces`);
    console.log(`  accepted        ${b.accepted} (${b.share.accepted}%)`);
    console.log(`  refused         ${b.refused} (${b.share.refused}%)`);
    console.log(`  not recoverable ${b.notRecoverable} (${b.share.notRecoverable}%)`);
    console.log("  refusal reasons (spaces):");
    for (const r of b.refusedBy) console.log(`    ${String(r.spaces).padStart(4)}  ${r.reason}`);
    console.log("  not recoverable, still missing (spaces):");
    for (const r of b.notRecoverableBy) console.log(`    ${String(r.spaces).padStart(4)}  ${r.reason}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(2);
  });
}
