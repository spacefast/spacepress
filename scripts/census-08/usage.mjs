#!/usr/bin/env node
// Usage catalog: for every Zero 0.8 feature (features.mjs), how many live Spaces use it, from how
// many distinct teams, and whether those Spaces had traffic in the last 30 days.
//
//   node scripts/census-08/usage.mjs --data <dir> [--json <summary.json>] [--markdown <table.md>]
//
// <dir> is the scratch export (keep it outside any repository):
//   ver_*.json         the stored finalize payload of each live version (`staticFiles[].contentBase64`
//                      kept where stored); a payload under out/ is read too
//   meta.tsv           version_id, space_id, team_id, team_slug, team_name, system_key,
//                      parent_team_id, personal_owner_user_id, space_slug (header row optional)
//   traffic-30d.tsv    space_id, served_requests over the last 30 days (optional)
//   parent-teams.tsv   team_id, team_slug, team_name of each parent team (optional)
//
// Formulas (one Space = one live version):
//   spaces(f)         Spaces whose detector returns true
//   teams(f)          distinct billing teams (parent team, else the team) among spaces(f)
//   external(f)       teams(f) minus internal teams (INTERNAL below)
//   active(f)         spaces(f) with served_requests > 0 in traffic-30d.tsv
//   unmeasured(f)     Spaces whose detector returns null (no evidence stored for them)
//   decision(f)       "Support" when external(f) >= SUPPORT_THRESHOLD, else "Rewrite on v2";
//                     "Not measured" when no Space could be measured
// The summary has counts and fixed labels only. Team names are read to classify and discarded.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { extract } from "./extract.mjs";
import { FEATURES, SECTIONS } from "./features.mjs";

/** Distinct non-internal teams a feature needs for v2 to support it. */
export const SUPPORT_THRESHOLD = 3;

/**
 * Internal teams, matched on the billing team (parent team, else the team) and on the team itself.
 * Each rule has a fixed label; the census reports how many teams each rule matched.
 */
export const INTERNAL = [
  ["system team (system_key set)", (t) => Boolean(t.systemKey)],
  ["Suat's Team (contractor)", (t) => /^suat\b|suat's team/i.test(t.name)],
  ["batuhan team", (t) => /^batuhan$/i.test(t.slug) || /^batuhan(\b|'s)/i.test(t.name)],
  ["Spacefast or Automattic staff team", (t) => /\b(spacefast|automattic|a8c|stattic)\b/i.test(`${t.slug} ${t.name}`)],
  ["test or QA team", (t) => /(^|[-_ ])(test|testing|qa|e2e|staging|demo|sandbox)([-_ ]|$)/i.test(`${t.slug} ${t.name}`)],
  ["Checkly monitoring", (t, space) => /checkly/i.test(`${t.slug} ${t.name} ${space?.slug ?? ""}`)],
];

function loadTypeScript() {
  const require = createRequire(import.meta.url);
  try {
    return require("typescript");
  } catch {
    return require(path.join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "typescript"));
  }
}

function tsv(file, columns) {
  if (!fs.existsSync(file)) return [];
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("\t"));
  if (rows.length && rows[0][0] === columns[0]) rows.shift();
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] === undefined || r[i] === "\\N" || r[i] === "NULL" ? "" : r[i]])));
}

/** `{ team, internal: label|null }` per version id, from meta.tsv and parent-teams.tsv. */
export function teams(dir) {
  const meta = tsv(path.join(dir, "meta.tsv"), ["version_id", "space_id", "team_id", "team_slug", "team_name", "system_key", "parent_team_id", "personal_owner_user_id", "space_slug"]);
  const parents = new Map(tsv(path.join(dir, "parent-teams.tsv"), ["team_id", "team_slug", "team_name", "system_key"]).map((p) => [p.team_id, p]));
  const out = new Map();
  for (const m of meta) {
    const own = { id: m.team_id, slug: m.team_slug, name: m.team_name, systemKey: m.system_key };
    const p = m.parent_team_id ? parents.get(m.parent_team_id) : null;
    const parent = p ? { id: p.team_id, slug: p.team_slug, name: p.team_name, systemKey: p.system_key } : null;
    const billing = m.parent_team_id || m.team_id;
    const space = { slug: m.space_slug };
    const rule = INTERNAL.find(([, test]) => test(own, space) || (parent && test(parent, space)));
    out.set(m.version_id, { space: m.space_id, team: billing || null, internal: rule ? rule[0] : null });
  }
  return out;
}

export function traffic(dir) {
  const rows = tsv(path.join(dir, "traffic-30d.tsv"), ["space_id", "served_requests"]);
  return rows.length ? new Map(rows.map((r) => [r.space_id, Number(r.served_requests) || 0])) : null;
}

function payloadFiles(dir) {
  const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^ver_[A-Za-z0-9_-]+\.json$/.test(f)).map((f) => path.join(d, f)) : []);
  const byName = new Map();
  for (const f of [...list(path.join(dir, "out")), ...list(dir)]) byName.set(path.basename(f), f);
  return [...byName.values()].sort();
}

/** One row per feature with its counts; `spaces` lists `{ version, teams, traffic }` per Space. */
export function catalog(spaces, threshold = SUPPORT_THRESHOLD) {
  return FEATURES.map((feature) => {
    let using = 0;
    let unmeasured = 0;
    let active = 0;
    let trafficKnown = 0;
    const all = new Set();
    const external = new Set();
    for (const s of spaces) {
      const hit = s.facts ? feature.detect(s.facts) : null;
      if (hit === null || hit === undefined) {
        unmeasured++;
        continue;
      }
      if (!hit) continue;
      using++;
      if (s.team) all.add(s.team);
      if (s.team && !s.internal) external.add(s.team);
      if (s.traffic !== null && s.traffic !== undefined) {
        trafficKnown++;
        if (s.traffic > 0) active++;
      }
    }
    const measured = spaces.length - unmeasured;
    const decision = measured === 0 ? "Not measured" : external.size >= threshold ? "Support" : "Rewrite on v2";
    return {
      id: feature.id,
      section: feature.section,
      label: feature.label,
      source: feature.source,
      added: feature.added,
      spaces: using,
      teams: all.size,
      externalTeams: external.size,
      activeSpaces: trafficKnown ? active : null,
      unmeasured,
      decision,
    };
  });
}

function markdown(rows, threshold, trafficRead) {
  const out = [];
  for (const section of SECTIONS) {
    out.push(`#### ${section}`, "");
    out.push(`| 0.8 capability | Spaces | Teams | Non-internal teams |${trafficRead ? " Spaces with traffic (30 d) |" : ""} Not measured | Decision |`);
    out.push(`| --- | ---: | ---: | ---: |${trafficRead ? " ---: |" : ""} ---: | --- |`);
    for (const r of rows.filter((r) => r.section === section)) {
      const label = r.added ? `${r.label} (added)` : r.label;
      out.push(`| ${label} | ${r.spaces} | ${r.teams} | ${r.externalTeams} |${trafficRead ? ` ${r.activeSpaces ?? "—"} |` : ""} ${r.unmeasured || "—"} | ${r.decision} |`);
    }
    out.push("");
  }
  out.push(`Support threshold: ${threshold} distinct non-internal teams.`);
  return out.join("\n");
}

async function main(argv) {
  const opts = { threshold: SUPPORT_THRESHOLD };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data") opts.data = argv[++i];
    else if (a === "--json") opts.json = argv[++i];
    else if (a === "--markdown") opts.markdown = argv[++i];
    else if (a === "--threshold") opts.threshold = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.data) throw new Error("usage: usage.mjs --data <dir> [--json <file>] [--markdown <file>] [--threshold N]");
  const ts = loadTypeScript();
  const teamOf = teams(opts.data);
  const trafficOf = traffic(opts.data);
  const spaces = payloadFiles(opts.data).map((file) => {
    const version = path.basename(file, ".json");
    const facts = extract(ts, JSON.parse(fs.readFileSync(file, "utf8")));
    const t = teamOf.get(version);
    return {
      facts,
      team: t?.team ?? null,
      internal: t?.internal ?? null,
      traffic: trafficOf && t ? (trafficOf.get(t.space) ?? 0) : null,
      clientMeasured: facts?.client.measured ?? false,
      clientPresent: facts?.client.present ?? false,
    };
  });
  const rows = catalog(spaces, opts.threshold);
  const internalRules = {};
  const seenTeams = new Map();
  for (const t of teamOf.values()) if (t.team) seenTeams.set(t.team, t.internal);
  for (const label of seenTeams.values()) if (label) internalRules[label] = (internalRules[label] ?? 0) + 1;
  const summary = {
    spaces: spaces.length,
    teams: seenTeams.size,
    internalTeams: [...seenTeams.values()].filter(Boolean).length,
    internalByRule: internalRules,
    teamsRead: teamOf.size > 0,
    trafficRead: Boolean(trafficOf),
    clientPresent: spaces.filter((s) => s.clientPresent).length,
    clientMeasured: spaces.filter((s) => s.clientMeasured).length,
    threshold: opts.threshold,
    features: rows,
  };
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(summary, null, 2));
  const md = markdown(rows, opts.threshold, summary.trafficRead);
  if (opts.markdown) fs.writeFileSync(opts.markdown, md);
  console.log(`spaces ${summary.spaces}  teams ${summary.teams} (internal ${summary.internalTeams})  client bundles ${summary.clientMeasured}/${summary.clientPresent}  traffic ${summary.trafficRead ? "read" : "not read"}`);
  for (const r of [...rows].sort((a, b) => b.spaces - a.spaces)) {
    console.log(`${String(r.spaces).padStart(4)} ${String(r.teams).padStart(4)} ${String(r.externalTeams).padStart(4)} ${String(r.activeSpaces ?? "-").padStart(4)} ${String(r.unmeasured || "").padStart(4)}  ${r.decision.padEnd(13)} ${r.id}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(2);
  });
}
