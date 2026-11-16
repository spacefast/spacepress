// Runs each example's own HTTP verifier against a real WordPress (Studio, through `typedpress dev`),
// so an example that compiles but no longer works fails CI. scripts/check-examples.sh only compiles them.
//
// Each example is copied to a temporary directory first (its tp/dist, .tp and node_modules left
// out), so a run never reuses or changes a developer's local site, and the site is deleted after.
// Two users sign in with application passwords: `admin` and a subscriber `other`.
//
//   node scripts/check-example-runs.mjs [example ...]       default: every example below
//   TP_BIN=path/to/typedpress   the compiler (default target/debug/typedpress)
//   TP_EXAMPLE_PORT=8940        the WordPress port (default 8940); it must be free
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = resolve(process.env.TP_BIN ?? join(root, "target/debug/typedpress"));
const port = Number(process.env.TP_EXAMPLE_PORT ?? 8940);
const STUDIO = "wp-studio@2.2.0"; // src/commands/dev.rs

// example -> its verifier, relative to the example.
const verifiers = {
  "drive-locker": "verify.mjs",
  "home-maintenance": "verify.mjs",
  "pet-food": "verify.mjs",
  "stuff-drawer": "verify.mjs",
  subscriptions: "scripts/verify.mjs",
};
const selected = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(verifiers);
for (const name of selected) if (!verifiers[name]) throw new Error(`no verifier for ${name}; known: ${Object.keys(verifiers).join(", ")}`);

async function free(at) {
  const server = createServer();
  try {
    await new Promise((done, fail) => { server.once("error", fail); server.listen(at, "127.0.0.1", done); });
    return true;
  } catch { return false; } finally { server.close(); }
}

const failed = [];
for (const name of selected) {
  if (!(await free(port))) throw new Error(`port ${port} is in use; set TP_EXAMPLE_PORT to a free one`);
  const work = mkdtempSync(join(tmpdir(), `tp-example-${name}-`));
  const project = join(work, "examples", name);
  cpSync(join(root, "examples", name), project, {
    recursive: true,
    filter: (source) => !/[\\/](\.tp|node_modules|tp[\\/]dist)([\\/]|$)/.test(source.slice(root.length)),
  });
  symlinkSync(join(root, "target"), join(work, "target")); // verifiers default to ../../target
  const tp = (...args) => execFileSync(binary, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const wp = (...args) => tp("wp", "--site", project, ...args);
  console.log(`\n=== ${name}`);
  let status = 1;
  try {
    tp("dev", project, "--port", String(port), "--no-watch");
    const site = JSON.parse(tp("dev", "status", project, "--json")).url.replace(/\/$/, "");
    if (site !== `http://localhost:${port}`) throw new Error(`Studio started ${name} at ${site}, not port ${port}`);
    try { wp("user", "get", "other", "--field=ID"); } catch { wp("user", "create", "other", "other@example.test", "--role=subscriber", "--porcelain"); }
    const password = (user) => wp("user", "application-password", "create", user, "check-example-runs", "--porcelain").split("\n").at(-1);
    const admin = `admin:${password("admin")}`;
    const other = `other:${password("other")}`;
    const run = spawnSync(process.execPath, [join(project, verifiers[name])], {
      stdio: "inherit", timeout: 15 * 60_000,
      env: { ...process.env, TP_BIN: binary, TP_SITE: site, TP_TEST_URL: site, TP_AUTH: admin, TP_OTHER_AUTH: other, TP_APP_PASSWORD: admin, TP_OTHER_APP_PASSWORD: other },
    });
    status = run.status ?? 1;
  } catch (error) {
    console.error(error.message);
  } finally {
    spawnSync(binary, ["dev", "stop", project], { stdio: "ignore" });
    spawnSync("npx", ["--yes", "--package", STUDIO, "--", "studio", "delete", "--path", join(project, ".tp/dev/wordpress"), "--no-files"], { stdio: "ignore", timeout: 120_000 });
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`=== ${name}: ${status === 0 ? "ok" : "FAILED"}`);
  if (status !== 0) failed.push(name);
}
if (failed.length) {
  console.error(`\n${failed.length} example(s) failed: ${failed.join(", ")}`);
  process.exit(1);
}
