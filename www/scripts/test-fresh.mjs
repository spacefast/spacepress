import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("../", import.meta.url));
const repo = resolve(site, "..");
const binary = process.env.SP_BIN ?? resolve(repo, process.env.CARGO_TARGET_DIR ?? "target", "debug/spacepress");
const port = Number(process.env.SP_WWW_PORT ?? 8960);
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, "SP_WWW_PORT must be a valid port");
const base = `http://localhost:${port}`;
const data = JSON.parse(readFileSync(join(site, "public/play-data.json"), "utf8"));
assert.equal(data.plugins, base, `Build the site first with PLUGINS_URL=${base} npm run build --prefix www`);

const probe = createServer();
await new Promise((done, fail) => probe.once("error", fail).listen(port, done));
await new Promise((done, fail) => probe.close((error) => error ? fail(error) : done()));

const work = realpathSync(mkdtempSync(join(tmpdir(), "sp-www-")));
const project = join(work, "www");
const studioSite = join(project, ".sp/dev/wordpress");

function run(command, args, { capture = false, env = process.env, timeout = 600_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd: project, env, timeout, encoding: "utf8",
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.signal})`);
  return capture ? result.stdout.trim() : undefined;
}

try {
  for (const entry of ["spacepress.config.ts", "tsconfig.json", "sp", "public", "content", "scripts/seed.mjs"]) {
    cpSync(join(site, entry), join(project, entry), {
      recursive: true,
      filter: (source) => relative(site, source) !== "sp/dist",
    });
  }
  run(binary, ["dev", "--port", String(port), "--no-watch"]);
  const state = JSON.parse(run(binary, ["dev", "status", "--json"], { capture: true }));
  assert.equal(state.site, studioSite);
  assert.equal(state.url, base);
  assert.equal(state.state, "running");
  assert.equal(state.error, null);

  const password = run(binary, ["wp", "user", "application-password", "create", "admin", "www-ci", "--porcelain"], { capture: true }).split("\n").at(-1);
  assert.ok(password, "WP-CLI returned no application password");
  const env = { ...process.env, SITE_URL: base, SP_TOKEN: "", SP_APP_PASSWORD: `admin:${password}` };
  run(binary, ["sync", "--site", base, "--no-commit"], { env });
  run(process.execPath, ["scripts/seed.mjs"], { env });
  run(process.execPath, ["--test", join(site, "tests/site.test.mjs")], {
    env: { ...process.env, SITE_URL: base },
  });
} finally {
  if (existsSync(join(studioSite, "wp-config.php"))) {
    run(binary, ["dev", "stop"], { timeout: 120_000 });
    run("npx", ["--yes", "--package", "wp-studio@2.2.0", "--", "studio", "delete", "--path", studioSite, "--no-files"], { timeout: 120_000 });
  }
  rmSync(work, { recursive: true, force: true });
}
