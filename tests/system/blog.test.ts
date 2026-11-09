// The system suite's third site: examples/blog as its owner installs it on a fresh WordPress (design
// §5.8 acceptance): the example's committed posts (content/posts/*.md) against the new site, where
// `zero sync --check` reports them (exit 2), `zero sync` creates them, and a second run is a no-op.
// The example is also built and checked for drift in tests/compiler.rs (the blog example test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { repo, work, zero } from "./project.ts";

const receipt: { url: string; users: Record<"editor", { appPassword: string }> } = JSON.parse(readFileSync(join(repo, "tests/system/.harness-blog.json"), "utf8"));
const harness = join(repo, "tests/wp/harness.sh");
const wpContent = join(repo, "tests/system/.wp-content-blog");
const project = join(work, "blog");
const wp = (...args: string[]) => execFileSync(harness, ["wp", ...args], { encoding: "utf8" }).trim();
const sync = (...flags: string[]) =>
  spawnSync(join(process.env.CARGO_TARGET_DIR ?? join(repo, "target"), "debug/zero"), ["sync", project, "--site", receipt.url, "--no-commit", "--json", ...flags], { encoding: "utf8", env: { ...process.env, ZERO_APP_PASSWORD: `editor:${receipt.users.editor.appPassword}` } });

test("the blog's committed posts sync into a fresh WordPress, once", async () => {
  rmSync(project, { recursive: true, force: true });
  cpSync(join(repo, "examples/blog"), project, { recursive: true, filter: (src) => !src.includes("/.zero") });
  zero("build", project, "--quiet");
  const built = join(project, "zero/dist/wp-content/plugins");
  for (const name of readdirSync(built).filter((n) => !n.endsWith(".zip"))) cpSync(join(built, name), join(wpContent, "plugins", name), { recursive: true });
  wp("plugin", "activate", "secure-custom-fields", "action-scheduler", "mcp-adapter", "two-factor", "polylang", "zero-runtime", "zero-identity", "zero-app-blog");

  const check = sync("--check");
  assert.equal(check.status, 2, check.stdout + check.stderr);
  const first = sync();
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(JSON.parse(first.stdout).data.applied, 2);
  // A no-op: nothing applied, written, refused or in conflict.
  const again = sync();
  assert.equal(again.status, 0, again.stdout + again.stderr);
  const { applied, written, refused, conflicts, failed } = JSON.parse(again.stdout).data;
  assert.deepEqual({ applied, written, refused, conflicts, failed }, { applied: 0, written: [], refused: [], conflicts: [], failed: [] });

  // Both posts, as the files say: the published one public, the draft only for staff.
  const api = `${receipt.url}/wp-json/zero/v1`;
  const editor = { Authorization: "Basic " + btoa(`editor:${receipt.users.editor.appPassword}`) };
  const posts = (await (await fetch(`${api}/posts?orderBy=title`, { headers: editor })).json()).data;
  assert.deepEqual(posts.map((p: { title: string; status: string; locale: string; tags: string[] }) => [p.title, p.status, p.locale, p.tags]), [
    ["Hello, Zero", "published", "en", ["news"]],
    ["Typed content, plain files", "draft", "en", ["guide"]],
  ]);
  const anon = (await (await fetch(`${api}/posts`)).json()).data;
  assert.deepEqual(anon.map((p: { title: string }) => p.title), ["Hello, Zero"]);
});
