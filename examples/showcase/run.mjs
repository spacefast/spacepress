#!/usr/bin/env node
// Local showcase orchestration. Builds and boots the existing WordPress harness; never deploys.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const example = dirname(fileURLToPath(import.meta.url));
const repo = resolve(example, "../..");
const state = join(repo, ".zero/showcase");
const app = join(state, "app");
const harness = join(state, "harness/wp/harness.sh");
const receiptFile = join(state, "receipt.json");
const ownerFile = join(state, "owner.json");
const knownFile = existsSync(ownerFile) ? ownerFile : receiptFile;
const known = existsSync(knownFile)
  ? JSON.parse(readFileSync(knownFile, "utf8"))
  : null;
const command = process.argv[2] ?? "up";
const project =
  process.env.ZERO_SHOWCASE_PROJECT ??
  known?.project ??
  `zero-showcase-${createHash("sha256").update(repo).digest("hex").slice(0, 8)}`;
const port = process.env.ZERO_SHOWCASE_PORT ?? known?.port ?? "8860";
if (
  !/^[a-z0-9][a-z0-9_-]*$/.test(project) ||
  !/^\d+$/.test(port) ||
  Number(port) < 1024 ||
  Number(port) > 65535
) {
  throw new Error(
    "Use a lowercase Compose project name and a port between 1024 and 65535.",
  );
}
if (known && (known.project !== project || known.port !== port)) {
  throw new Error(
    "This checkout already owns a showcase. Use its saved project/port settings.",
  );
}
const env = {
  ...process.env,
  ZERO_WP_PROJECT: project,
  ZERO_WP_PORT: port,
  ZERO_WP_HARNESS: dirname(harness),
};
const run = (file, args, options = {}) =>
  execFileSync(file, args, { cwd: repo, env, stdio: "inherit", ...options });
const wp = (...args) =>
  run("bash", [harness, "wp", ...args], {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  }).trim();

function receipt() {
  if (!existsSync(receiptFile))
    throw new Error("Start the showcase first: node examples/showcase/run.mjs");
  const saved = JSON.parse(readFileSync(receiptFile, "utf8"));
  if (saved.project !== project || saved.port !== port)
    throw new Error(
      "Use the same ZERO_SHOWCASE_PROJECT and ZERO_SHOWCASE_PORT as the running showcase.",
    );
  return saved;
}

async function clients(saved) {
  const { createClient } = await import(
    pathToFileURL(join(app, "public/client/index.js")).href
  );
  return {
    publicClient: createClient({ url: `${saved.url}/wp-json/zero/v1` }),
    editor: createClient({
      url: `${saved.url}/wp-json/zero/v1`,
      headers: {
        authorization: `Basic ${Buffer.from(`editor:${saved.users.editor.appPassword}`).toString("base64")}`,
      },
    }),
  };
}

async function seed(saved) {
  const { editor } = await clients(saved);
  if ((await editor.stories.list({ limit: 1 })).length > 0) return;
  // Original, generated artwork; no external image fetch or additional package.
  const png = run("php", [join(example, "cover.php")], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const cover = await editor.media.upload(
    new Blob([png], { type: "image/png" }),
    {
      filename: "field-notes.png",
      alt: "Green mountains under a pale yellow sun",
    },
  );
  const first = await editor.stories.create({
    title: "Make room for the work that matters",
    status: "published",
    body: "<p>This is a real WordPress post, created through Zero’s generated client. Open the native editor, change a sentence, and publish it.</p><p>The fields below the editor come from the same TypeScript config as the API.</p>",
    cover: cover.id,
    details: {
      subtitle:
        "One config. A native editor, a typed API, and room to build your own front end.",
      featured: true,
    },
    links: [
      { label: "Zero on GitHub", href: "https://github.com/spacefast/zero" },
    ],
    sections: [
      {
        layout: "quote",
        text: "Less glue. More of your idea.",
        cite: "The notebook",
      },
    ],
    metadata: { edition: 1, tags: ["editorial", "native"] },
  });
  const second = await editor.stories.create({
    title: "The editor is only the beginning",
    status: "published",
    body: "<p>Tasks are rows in a real MariaDB table. A typed relation connects them to stories stored in WordPress. The headline action runs a compiled TypeScript class in PHP.</p>",
    details: {
      subtitle:
        "Join post-backed content to SQL tables, then add the actions your app needs.",
      featured: false,
    },
    links: [],
    sections: [
      {
        layout: "callout",
        heading: "Try the boundary",
        body: "Readers can browse. Editors can change things.",
      },
    ],
    metadata: { edition: 2 },
  });
  for (const [title, storyId, done] of [
    ["Tighten the opening paragraph", first.id, false],
    ["Choose a cover image", first.id, true],
    ["Try the headline action", second.id, false],
  ])
    await editor.tasks.create({
      title,
      storyId,
      done,
      editorNote: "Only signed-in editors can read this note.",
    });
}

async function check(saved) {
  const { publicClient, editor } = await clients(saved);
  const stories = await publicClient.stories.list({
    with: { tasks: true, cover: true },
  });
  assert.ok(stories.length >= 2, "Seeded stories are publicly readable");
  const tasks = await publicClient.tasks.list({ with: { story: true } });
  assert.ok(
    tasks.some((task) => task.story && task.story.id === task.storyId),
    "SQL task resolves its WordPress story",
  );
  assert.equal(
    tasks.some((task) => "editorNote" in task),
    false,
    "Public reads mask editor notes",
  );
  assert.deepEqual(
    await publicClient.actions.previewHeadline({ title: "  Hello, Zero!  " }),
    { title: "Hello, Zero!", slug: "hello-zero", characters: 12 },
  );
  console.log(
    "PASS public reads, cross-kind relation, field masking, compiled class/action",
  );
  await assert.rejects(
    () => publicClient.tasks.create({ title: "Must be denied" }),
    (error) => error.status === 401 || error.status === 403,
  );
  let task;
  try {
    task = await editor.tasks.create({
      title: "  Smoke check  ",
      storyId: stories[0].id,
      editorNote: "Private smoke check",
    });
    assert.equal(
      task.title,
      "Smoke check",
      "beforeCreate hook trims the title",
    );
    assert.equal(task.editorNote, "Private smoke check");
    const updated = await editor.tasks.update(task.id, { done: true });
    assert.equal(updated.done, true);
  } finally {
    if (task) await editor.tasks.delete(task.id);
  }
  console.log(
    "PASS write authority, hook, editor field access, update and cleanup",
  );
  const cover = stories.find((story) => story.cover)?.cover;
  assert.ok(cover?.sizes.card, "Seed image has a generated card derivative");
  assert.equal((await fetch(cover.sizes.card.url)).status, 200);
  const page = await fetch(
    `${saved.url}/wp-content/plugins/zero-app-showcase/public/`,
  );
  assert.equal(page.status, 200);
  console.log("PASS generated media delivery and showcase page");
}

function show(saved) {
  console.log(
    `\nShowcase: ${saved.url}/wp-content/plugins/zero-app-showcase/public/\nAdmin:    ${saved.url}/zero-admin/\nLogin:    editor / zero-test-editor\n\nCheck: node examples/showcase/run.mjs check\nStop:  node examples/showcase/run.mjs down\n\nDisposable local credentials only. Stop removes the demo database.\n`,
  );
}

async function main() {
  if (command === "check") return check(receipt());
  if (command === "down") {
    if (!known)
      throw new Error("No showcase has been started in this checkout.");
    if (existsSync(harness)) run("bash", [harness, "down"]);
    console.log(
      "Showcase stopped. Its disposable database and uploads were removed.",
    );
    return;
  }
  if (command !== "up")
    throw new Error("Usage: node examples/showcase/run.mjs [up|check|down]");
  mkdirSync(state, { recursive: true });
  writeFileSync(ownerFile, JSON.stringify({ project, port }), { mode: 0o600 });
  run("cargo", ["build", "--locked", "--quiet"]);
  const zero = resolve(
    repo,
    process.env.CARGO_TARGET_DIR ?? "target",
    "debug/zero",
  );
  mkdirSync(app, { recursive: true });
  copyFileSync(join(example, "zero.config.ts"), join(app, "zero.config.ts"));
  cpSync(join(example, "public"), join(app, "public"), { recursive: true });
  run(zero, ["build", app, "--quiet"]);
  mkdirSync(join(app, "public/client"), { recursive: true });
  for (const name of ["index", "schema"]) {
    const source = readFileSync(join(app, `zero/client/${name}.ts`), "utf8");
    writeFileSync(
      join(app, `public/client/${name}.js`),
      stripTypeScriptTypes(source).replace(
        /(from\s+["']\.\/[\w-]+)\.ts(["'])/g,
        "$1.js$2",
      ),
    );
  }
  copyFileSync(
    join(app, "zero/client/LICENSE"),
    join(app, "public/client/LICENSE"),
  );
  copyFileSync(join(app, "zero.config.ts"), join(app, "public/source.ts.txt"));
  copyFileSync(
    join(
      app,
      ".zero/wp-content/plugins/zero-app-showcase/zero/app/functions.php",
    ),
    join(app, "public/compiled.php.txt"),
  );
  run(zero, ["build", app, "--quiet"]);
  const content = join(state, "wp-content");
  mkdirSync(content, { recursive: true });
  run("rsync", ["-a", "--delete", `${app}/.zero/wp-content/`, `${content}/`]);
  // Private copy gives this demo its own harness state; parallel suites keep their state.
  for (const file of [
    "harness.sh",
    "compose.yml",
    "mu-plugins/capture-mail.php",
    "php/zz-zero-tests.ini",
    "apache/zz-zero-tests.conf",
  ]) {
    const target = join(dirname(harness), file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repo, "tests/wp", file), target);
  }
  const compose = join(dirname(harness), "compose.yml");
  writeFileSync(
    compose,
    readFileSync(compose, "utf8").replace(
      '"${ZERO_WP_PORT:-8790}:80"',
      '"127.0.0.1:${ZERO_WP_PORT:-8790}:80"',
    ),
  );
  mkdirSync(join(state, "harness/fixtures"), { recursive: true });
  copyFileSync(
    join(repo, "tests/fixtures/platform.json"),
    join(state, "harness/fixtures/platform.json"),
  );
  const output = run("bash", [harness, "up", "--wp-content", content], {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  const saved = { ...JSON.parse(output.trim()), project, port };
  writeFileSync(receiptFile, JSON.stringify(saved, null, 2), { mode: 0o600 });
  wp("option", "update", "blogname", "Zero showcase");
  await seed(saved);
  await check(saved);
  show(saved);
}

main().catch((error) => {
  console.error(`Showcase failed: ${error.message}`);
  if (existsSync(ownerFile))
    console.error(
      "Inspect the running demo, or stop it with: node examples/showcase/run.mjs down",
    );
  process.exitCode = 1;
});
