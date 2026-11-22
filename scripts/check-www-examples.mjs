// The website's example trees (www/examples/) either compile or are marked as proposals.
//
// - Every project with a typedpress.config.ts must pass `typedpress check`, including every one
//   under www/examples/_today/ (code as it runs today, which the guide compares the proposals with).
// - A project whose _meta.json has a `proposal` string is written in spellings that are decided and
//   not built yet; the guide shows it as text and says so. It is skipped here, and it must never be
//   offered as runnable: no playground, showcase build, download or seed reads it. Those read
//   examples/<name> (www/lib/site-examples.ts, www/scripts/build-showcase.ts,
//   www/scripts/run-data.ts, www/scripts/seed.mjs) and www/examples/_hero; this script fails when any
//   of them, or a page or script of the website, names a proposal's own directory.
//
//   node scripts/check-www-examples.mjs [path/to/typedpress]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = process.argv[2] ?? join(root, "target/debug/typedpress");
const www = join(root, "www/examples");
const failures = [];

const files = (dir, keep) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  if (entry === "node_modules" || entry.startsWith(".") || entry === "_generated") return [];
  return statSync(full).isDirectory() ? files(full, keep) : keep(entry) ? [full] : [];
});

const proposals = [];
for (const project of readdirSync(www).sort()) {
  const meta = join(www, project, "_meta.json");
  if (!existsSync(meta)) continue;
  const { proposal } = JSON.parse(readFileSync(meta, "utf8"));
  if (proposal === undefined) continue;
  if (typeof proposal !== "string" || proposal.trim() === "") failures.push(`www/examples/${project}/_meta.json: "proposal" must say why the project is not built`);
  proposals.push(project);
}

for (const config of files(www, (name) => name === "typedpress.config.ts").sort()) {
  const dir = join(config, "..");
  const rel = relative(root, dir);
  if (proposals.includes(relative(www, dir).split("/")[0])) {
    console.log(`skip  ${rel} (proposal, shown as text only)`);
    continue;
  }
  try {
    execFileSync(binary, ["check", dir], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    console.log(`ok    ${rel}`);
  } catch (error) {
    console.log(`FAIL  ${rel}\n      ${`${error.stdout ?? ""}${error.stderr ?? ""}`.trim().replace(/\n/g, "\n      ")}`);
    failures.push(`${rel} does not compile`);
  }
}

// What builds or runs an example: none of it may read a proposal's directory.
const runners = [
  "www/lib/site-examples.ts", "www/lib/examples.ts", "www/scripts/build-showcase.ts",
  ...files(join(root, "www/scripts"), (name) => /\.(m?js|ts)$/.test(name)).map((file) => relative(root, file)),
  ...files(join(root, "www/tp"), (name) => /\.(tsx?|m?js)$/.test(name)).map((file) => relative(root, file)).filter((file) => !file.startsWith("www/tp/data/")),
  ...files(join(root, "www/browser"), (name) => /\.(m?js|ts)$/.test(name)).map((file) => relative(root, file)),
];
for (const name of proposals) {
  const path = new RegExp(`(www/|\\.\\./)examples/${name}\\b`);
  for (const file of runners) {
    if (existsSync(join(root, file)) && path.test(readFileSync(join(root, file), "utf8"))) {
      failures.push(`${file} reads the proposal www/examples/${name}; proposals are shown as text, never built or run`);
    }
  }
}

if (failures.length) {
  console.log(`\n${failures.length} problem(s):\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`\nwww/examples: every project compiles or is a labelled proposal (${proposals.join(", ") || "none"}), and no proposal is offered as runnable`);
