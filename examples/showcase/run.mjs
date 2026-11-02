#!/usr/bin/env node
// Local showcase orchestration. Builds and boots the existing WordPress harness; never deploys.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as nodeModule from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const example = dirname(fileURLToPath(import.meta.url));
const repo = resolve(example, "../..");
const state = resolve(
  repo,
  process.env.ZERO_SHOWCASE_STATE_DIR ?? ".zero/showcase",
);
const app = join(state, "app");
const harness = join(state, "harness/wp/harness.sh");
const receiptFile = join(state, "receipt.json");
const ownerFile = join(state, "owner.json");
const ownerLabel = "io.zero.showcase.state";
const ownerId = createHash("sha256").update(state).digest("hex");
const knownFile = existsSync(ownerFile) ? ownerFile : receiptFile;
const known = existsSync(knownFile)
  ? JSON.parse(readFileSync(knownFile, "utf8"))
  : null;
const command = process.argv[2] ?? "up";
const project =
  process.env.ZERO_SHOWCASE_PROJECT ??
  known?.project ??
  `zero-showcase-${createHash("sha256").update(state).digest("hex").slice(0, 8)}`;
const port = process.env.ZERO_SHOWCASE_PORT ?? known?.port ?? "8860";
const publicAddress = new URL(
  process.env.ZERO_SHOWCASE_URL ??
    known?.publicUrl ??
    `http://127.0.0.1:${port}`,
);
if (
  !["http:", "https:"].includes(publicAddress.protocol) ||
  publicAddress.username ||
  publicAddress.password ||
  publicAddress.pathname !== "/" ||
  publicAddress.search ||
  publicAddress.hash
)
  throw new Error(
    "ZERO_SHOWCASE_URL must be an HTTP(S) origin without a path or credentials.",
  );
const publicUrl = publicAddress.origin;
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
    `This state directory already owns a showcase. Use its saved project/port settings: ${state}`,
  );
}
const env = {
  ...process.env,
  ZERO_WP_PROJECT: project,
  ZERO_WP_PORT: port,
  ZERO_WP_HARNESS: dirname(harness),
  ZERO_WP_CONTENT: join(state, "wp-content"),
  ZERO_WP_S3: "0",
  ZERO_WP_UID: String(process.getuid()),
  ZERO_WP_GID: String(process.getgid()),
};
const run = (file, args, options = {}) =>
  execFileSync(file, args, { cwd: repo, env, stdio: "inherit", ...options });
const http = (url, options) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
const wp = (...args) =>
  run("bash", [harness, "wp", ...args], {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  }).trim();

const invocation = process.env.ZERO_SHOWCASE_STATE_DIR
  ? `ZERO_SHOWCASE_STATE_DIR='${state.replaceAll("'", "'\\''")}' node examples/showcase/run.mjs`
  : "node examples/showcase/run.mjs";

function prerequisites(mode) {
  const problems = [];
  if (
    mode !== "down" &&
    (typeof nodeModule.stripTypeScriptTypes !== "function" ||
      Number(process.versions.node.split(".")[0]) < 22 ||
      (process.versions.node.startsWith("22.") &&
        Number(process.versions.node.split(".")[1]) < 18))
  )
    problems.push("Node 22.18+ is required");
  const probes =
    mode === "up"
      ? [
          ["cargo", ["--version"]],
          ["bash", ["-c", "(( BASH_VERSINFO[0] >= 4 ))"]],
          ["python3", ["--version"]],
          ["curl", ["--version"]],
          ["sha256sum", ["--version"]],
          ["rsync", ["--version"]],
        ]
      : [];
  if (mode !== "down")
    probes.push(["php", ["-r", 'exit(extension_loaded("gd") ? 0 : 1);']]);
  if (mode !== "check")
    probes.push(
      ["docker", ["compose", "version"]],
      ["docker", ["info", "--format", "{{.ServerVersion}}"]],
    );
  for (const [file, args] of probes) {
    try {
      run(file, args, { stdio: "pipe", timeout: 15000 });
    } catch (error) {
      const detail =
        error.code === "ENOENT"
          ? "not found on PATH"
          : file === "php"
            ? "PHP with GD is required"
            : file === "bash"
              ? "Bash 4+ is required"
              : error.stderr?.toString().trim() || error.message;
      problems.push(`${file} ${args.slice(0, 2).join(" ")}: ${detail}`);
    }
  }
  if (problems.length)
    throw new Error(
      `Missing or unavailable prerequisites:\n- ${problems.join("\n- ")}\nSee CONTRIBUTING.md#toolchain.`,
    );
}

function receipt() {
  if (!existsSync(receiptFile))
    throw new Error(`Start the showcase first: ${invocation}`);
  const saved = JSON.parse(readFileSync(receiptFile, "utf8"));
  if (saved.project !== project || saved.port !== port)
    throw new Error(
      "Use the same ZERO_SHOWCASE_PROJECT and ZERO_SHOWCASE_PORT as the running showcase.",
    );
  return saved;
}

function verifyOwnership() {
  const capture = (args) =>
    run("docker", args, { stdio: "pipe", encoding: "utf8" }).trim();
  const foreign = [];
  const ownedContainers = new Set();
  let ownsPort = false;
  for (const [kind, list, names] of [
    [
      "container",
      ["ps", "-aq"],
      ["db", "wordpress", "cli"].map((service) => `${project}-${service}-1`),
    ],
    ["volume", ["volume", "ls", "-q"], [`${project}_wp`]],
    ["network", ["network", "ls", "-q"], [`${project}_default`]],
  ]) {
    const ids = new Set(
      capture([
        ...list,
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ])
        .split("\n")
        .filter(Boolean),
    );
    // Also catch same-named resources with missing or different project labels.
    for (const name of names) {
      const match = capture([...list, "--filter", `name=^/?${name}$`]);
      for (const id of match.split("\n").filter(Boolean)) ids.add(id);
    }
    if (!ids.size) continue;
    const resources = JSON.parse(capture([kind, "inspect", ...ids]));
    for (const resource of resources) {
      const labels =
        kind === "container" ? resource.Config.Labels : resource.Labels;
      const owned =
        labels?.[ownerLabel] === ownerId &&
        labels?.["com.docker.compose.project"] === project;
      const sameConfig =
        kind !== "container" ||
        (labels?.["com.docker.compose.project.config_files"] ===
          join(dirname(harness), "compose.yml") &&
          labels?.["com.docker.compose.project.working_dir"] ===
            dirname(harness));
      if (!owned || !sameConfig)
        foreign.push(`${kind} ${resource.Name ?? resource.Id}`);
      else if (kind === "container") {
        ownedContainers.add(resource.Id);
        if (
          resource.State.Running &&
          labels["com.docker.compose.service"] === "wordpress" &&
          resource.NetworkSettings.Ports?.["80/tcp"]?.some(
            (binding) =>
              binding.HostIp === "127.0.0.1" && binding.HostPort === port,
          )
        )
          ownsPort = true;
      }
      if (
        kind === "network" &&
        Object.keys(resource.Containers ?? {}).some(
          (id) => !ownedContainers.has(id),
        )
      )
        foreign.push(
          `network ${resource.Name} has foreign attached containers`,
        );
      if (kind === "volume") {
        const users = capture([
          "ps",
          "-aq",
          "--no-trunc",
          "--filter",
          `volume=${resource.Name}`,
        ])
          .split("\n")
          .filter(Boolean);
        if (users.some((id) => !ownedContainers.has(id)))
          foreign.push(
            `volume ${resource.Name} has foreign attached containers`,
          );
      }
    }
  }
  if (foreign.length)
    throw new Error(
      `Refusing to change a Compose project with unverified resources:\n- ${foreign.join("\n- ")}\nUse a different ZERO_SHOWCASE_PROJECT and state directory. A saved receipt is not proof of Docker ownership; older unlabeled showcases require explicit manual inspection/cleanup.`,
    );
  return ownsPort;
}

async function verifyPort(ownsPort) {
  if (ownsPort) return;
  const publishers = run(
    "docker",
    ["ps", "--filter", `publish=${port}`, "--format", "{{.Names}}"],
    { stdio: "pipe", encoding: "utf8" },
  ).trim();
  if (publishers)
    throw new Error(
      `Cannot bind showcase port 127.0.0.1:${port}: already published by Docker (${publishers.replaceAll("\n", ", ")}). Choose another ZERO_SHOWCASE_PORT on a new state directory.`,
    );
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) =>
      reject(
        new Error(
          `Cannot bind showcase port 127.0.0.1:${port}: ${error.message}. Choose another ZERO_SHOWCASE_PORT on a new state directory.`,
        ),
      ),
    );
    server.listen(
      { host: "127.0.0.1", port: Number(port), exclusive: true },
      () => server.close(resolve),
    );
  });
}

async function clients(saved) {
  const { createClient } = await import(
    pathToFileURL(join(app, "public/client/index.js")).href
  );
  return {
    publicClient: createClient({
      url: `${saved.url}/wp-json/zero/v1`,
      fetch: http,
    }),
    editor: createClient({
      url: `${saved.url}/wp-json/zero/v1`,
      fetch: http,
      headers: {
        authorization: `Basic ${Buffer.from(`editor:${saved.users.editor.appPassword}`).toString("base64")}`,
      },
    }),
  };
}

function coverPng() {
  // Original, generated artwork; no external image fetch or additional package.
  return run("php", [join(example, "cover.php")], {
    stdio: ["ignore", "pipe", "inherit"],
  });
}

async function seedClassic(saved) {
  const { editor } = await clients(saved);
  if (
    wp(
      "eval",
      "echo get_option('zero_showcase_seeded', false) ? 'yes' : 'no';",
    ) === "yes"
  )
    return;
  const png = coverPng();
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
  wp("option", "update", "zero_showcase_seeded", "1");
}

async function seedPantry(saved) {
  if (
    wp(
      "eval",
      "echo get_option('zero_showcase_pantry_seeded', false) ? 'yes' : 'no';",
    ) === "yes"
  )
    return;
  const { editor } = await clients(saved);
  const fridge = await editor.locations.create({
    name: "Fridge",
    kind: "fridge",
  });
  const cupboard = await editor.locations.create({
    name: "Kitchen cupboard",
    kind: "pantry",
  });
  const freezer = await editor.locations.create({
    name: "Freezer",
    kind: "freezer",
  });
  const inDays = (days) =>
    new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  for (const item of [
    {
      name: "Eggs",
      quantity: 2,
      unit: "pcs",
      lowStockAt: 2,
      locationId: fridge.id,
      expiresOn: inDays(7),
    },
    {
      name: "Milk",
      quantity: 800,
      unit: "ml",
      lowStockAt: 250,
      locationId: fridge.id,
      expiresOn: inDays(3),
    },
    {
      name: "Chickpeas",
      quantity: 3,
      unit: "pcs",
      lowStockAt: 1,
      locationId: cupboard.id,
    },
    {
      name: "Rolled oats",
      quantity: 750,
      unit: "g",
      lowStockAt: 150,
      locationId: cupboard.id,
    },
    {
      name: "Frozen peas",
      quantity: 600,
      unit: "g",
      lowStockAt: 150,
      locationId: freezer.id,
    },
    {
      name: "Lemons",
      quantity: 0,
      unit: "pcs",
      lowStockAt: 1,
      locationId: fridge.id,
    },
  ])
    await editor.items.create(item);
  const coffee = await editor.items.create({
    name: "Coffee bags",
    quantity: 0,
    unit: "pcs",
    lowStockAt: 1,
    locationId: cupboard.id,
  });
  await editor.actions.restock({ itemId: coffee.id, amount: 3 });
  wp("option", "update", "zero_showcase_pantry_seeded", "1");
}

async function seed(saved) {
  await seedClassic(saved);
  await seedPantry(saved);
}

async function checkPantry(publicClient, editor) {
  let location, item, anonymousItem, failure;
  try {
    await assert.rejects(
      async () => {
        anonymousItem = await publicClient.items.create({
          name: "Must be denied",
        });
      },
      (error) => error.status === 401 || error.status === 403,
    );
    location = await editor.locations.create({
      name: "Temporary check shelf",
      kind: "pantry",
    });
    item = await editor.items.create({
      name: "  Temporary chickpeas  ",
      quantity: 1,
      lowStockAt: 1,
      locationId: location.id,
    });
    assert.equal(
      item.name,
      "Temporary chickpeas",
      "Pantry hook trims item names",
    );
    const publicItems = await publicClient.items.list({
      where: { id: item.id },
      with: { location: true },
    });
    assert.equal(publicItems.length, 1);
    assert.equal(
      publicItems[0].location.id,
      location.id,
      "Public pantry reads resolve location",
    );
    const shelves = await publicClient.locations.list({
      where: { id: location.id },
      with: { items: true },
    });
    assert.deepEqual(
      shelves[0].items.map((row) => row.id),
      [item.id],
    );
    const initial = await publicClient.shoppingList.list({
      where: { itemId: item.id },
      with: { item: true },
    });
    assert.equal(
      initial.length,
      1,
      "Low-stock creation adds one shopping entry",
    );
    assert.equal(initial[0].done, false);
    assert.equal(initial[0].item.id, item.id);
    for (const action of ["consume", "restock"]) {
      await assert.rejects(
        () => publicClient.actions[action]({ itemId: item.id, amount: 1 }),
        (error) => error.status === 401 || error.status === 403,
      );
      await assert.rejects(
        () => editor.actions[action]({ itemId: item.id, amount: 0 }),
        (error) => error.status === 400 || error.status === 422,
      );
    }
    await assert.rejects(
      () => editor.items.update(item.id, { quantity: -1 }),
      (error) => error.status === 400 || error.status === 422,
    );
    let result = await editor.actions.restock({ itemId: item.id, amount: 3 });
    assert.equal(result.item.quantity, 4);
    let entries = await publicClient.shoppingList.list({
      where: { itemId: item.id },
    });
    assert.equal(
      entries[0].done,
      true,
      "Buying enough completes the shopping entry",
    );
    result = await editor.actions.consume({ itemId: item.id, amount: 3 });
    assert.equal(result.item.quantity, 1);
    entries = await publicClient.shoppingList.list({
      where: { itemId: item.id },
    });
    assert.equal(entries.length, 1);
    assert.equal(
      entries[0].id,
      initial[0].id,
      "Next low-stock crossing reuses the same entry",
    );
    assert.equal(entries[0].done, false);
    result = await editor.actions.consume({ itemId: item.id, amount: 10 });
    assert.equal(
      result.item.quantity,
      0,
      "Consumption never makes stock negative",
    );
    result = await editor.actions.restock({ itemId: item.id, amount: 1 });
    assert.equal(result.item.quantity, 1);
    entries = await publicClient.shoppingList.list({
      where: { itemId: item.id },
    });
    assert.equal(
      entries.length,
      1,
      "Repeated low stock never duplicates shopping rows",
    );
    assert.equal(
      entries[0].done,
      false,
      "Partial restock stays on the shopping list",
    );
    result = await editor.actions.restock({ itemId: item.id, amount: 3 });
    assert.equal(result.item.quantity, 4);
    const renamed = await editor.items.update(item.id, {
      name: "  Renamed chickpeas  ",
    });
    assert.equal(renamed.name, "Renamed chickpeas");
    entries = await publicClient.shoppingList.list({
      where: { itemId: item.id },
    });
    assert.equal(entries[0].name, renamed.name);
    assert.equal(entries[0].done, true);
    await editor.locations.delete(location.id);
    const unplaced = await publicClient.items.list({ where: { id: item.id } });
    assert.equal(
      unplaced[0].locationId,
      null,
      "Removing a location preserves its items",
    );
    location = undefined;
    await editor.items.delete(item.id);
    assert.deepEqual(
      await publicClient.shoppingList.list({ where: { itemId: item.id } }),
      [],
      "Removing an item removes its shopping entry",
    );
    item = undefined;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const failures = [];
    for (const owned of [item, anonymousItem]) {
      if (!owned) continue;
      try {
        const entries = await editor.shoppingList.list({
          where: { itemId: owned.id },
        });
        for (const entry of entries) await editor.shoppingList.delete(entry.id);
      } catch (error) {
        failures.push(
          `shopping entries for item ${owned.id}: ${error.message}`,
        );
      }
      try {
        await editor.items.delete(owned.id);
      } catch (error) {
        failures.push(`item ${owned.id}: ${error.message}`);
      }
    }
    if (location) {
      try {
        await editor.locations.delete(location.id);
      } catch (error) {
        failures.push(`location ${location.id}: ${error.message}`);
      }
    }
    if (failures.length)
      throw new Error(
        `${failure ? `${failure.message}\n` : ""}Pantry check cleanup failed:\n${failures.join("\n")}`,
      );
  }
  console.log(
    "PASS pantry public relations, stock constraints, editor actions, shopping lifecycle and cleanup",
  );
}

async function check(saved) {
  const { publicClient, editor } = await clients(saved);
  assert.deepEqual(
    await publicClient.actions.previewHeadline({ title: "  Hello, Zero!  " }),
    { title: "Hello, Zero!", slug: "hello-zero", characters: 12 },
  );
  await checkPantry(publicClient, editor);
  let task, story, cover, anonymousTask, failure;
  try {
    await assert.rejects(
      async () => {
        anonymousTask = await publicClient.tasks.create({
          title: "Must be denied",
        });
      },
      (error) => error.status === 401 || error.status === 403,
    );
    const png = coverPng();
    cover = await editor.media.upload(new Blob([png], { type: "image/png" }), {
      filename: "zero-smoke-check.png",
      alt: "Temporary showcase smoke check",
    });
    story = await editor.stories.create({
      title: "Temporary showcase smoke check",
      status: "published",
      cover: cover.id,
    });
    task = await editor.tasks.create({
      title: "  Smoke check  ",
      storyId: story.id,
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
    const stories = await publicClient.stories.list({
      where: { id: story.id },
      with: { tasks: true, cover: true },
    });
    assert.equal(stories.length, 1, "Published story appears in public list");
    const readable = stories[0];
    assert.equal(
      readable.title,
      story.title,
      "Published stories are publicly readable",
    );
    assert.equal(readable.cover.id, cover.id, "Story resolves its media");
    assert.deepEqual(
      readable.tasks.map((row) => row.id),
      [task.id],
    );
    const tasks = await publicClient.tasks.list({
      where: { id: task.id },
      with: { story: true },
    });
    assert.equal(tasks.length, 1, "SQL task appears in public list");
    const linked = tasks[0];
    assert.equal(
      linked.story.id,
      story.id,
      "SQL task resolves its WordPress story",
    );
    assert.equal(
      "editorNote" in linked,
      false,
      "Public reads mask editor notes",
    );
    assert.equal(
      "editorNote" in readable.tasks[0],
      false,
      "Nested public reads mask editor notes",
    );
    console.log(
      "PASS public reads, cross-kind relations, field masking, compiled class/action",
    );

    const original = await http(cover.url);
    assert.equal(original.status, 200);
    assert.deepEqual(
      Buffer.from(await original.arrayBuffer()),
      png,
      "HTTP serves the uploaded PNG bytes",
    );
    assert.ok(cover.sizes.card, "Upload has a generated card derivative");
    const card = await http(cover.sizes.card.url);
    assert.equal(card.status, 200);
    assert.equal(card.headers.get("content-type")?.split(";")[0], "image/png");
    const dimensions = run(
      "php",
      [
        "-r",
        "$image = imagecreatefromstring(stream_get_contents(STDIN)); if (!$image) exit(1); echo json_encode([imagesx($image), imagesy($image)]);",
      ],
      {
        input: Buffer.from(await card.arrayBuffer()),
        stdio: ["pipe", "pipe", "inherit"],
        encoding: "utf8",
      },
    );
    assert.deepEqual(
      JSON.parse(dimensions),
      [960, 600],
      "HTTP derivative decodes to the configured dimensions",
    );
    const page = await http(
      `${saved.url}/wp-content/plugins/zero-app-showcase/public/`,
    );
    assert.equal(page.status, 200);
    console.log(
      "PASS original media bytes, decoded card derivative and showcase page",
    );
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    // Try every cleanup even when one fails; preserve the evidence of any failure.
    const failures = [];
    for (const [name, row, collection] of [
      ["task", task, editor.tasks],
      ["unexpected anonymous task", anonymousTask, editor.tasks],
      ["story", story, editor.stories],
      ["media", cover, editor.media],
    ]) {
      if (!row) continue;
      try {
        await collection.delete(row.id);
      } catch (error) {
        failures.push(`${name} ${row.id}: ${error.message}`);
      }
    }
    if (failures.length)
      throw new Error(
        `${failure ? `${failure.message}\n` : ""}Smoke check cleanup failed:\n${failures.join("\n")}`,
      );
  }
  console.log(
    "PASS write authority, hook, editor field access, update and cleanup",
  );
}

function show(saved) {
  console.log(
    `\nShowcase: ${saved.url}/wp-content/plugins/zero-app-showcase/public/\nPantry:   ${saved.url}/wp-content/plugins/zero-app-showcase/public/#pantry\nAdmin:    ${saved.url}/zero-admin/\nClassic:  ${saved.url}/wp-admin/\nLogin:    editor / zero-test-editor\n\nCheck: ${invocation} check\nStop:  ${invocation} down\n\nDisposable local credentials only. Stop removes the demo database.\n`,
  );
}

async function main() {
  if (command === "check") {
    const saved = receipt();
    prerequisites("check");
    return check(saved);
  }
  if (command === "down") {
    if (!known)
      throw new Error(`No showcase is owned by this state directory: ${state}`);
    prerequisites("down");
    verifyOwnership();
    // Compose can remove a partially started stack even if the private harness is missing.
    const compose = join(dirname(harness), "compose.yml");
    run("docker", [
      "compose",
      "-p",
      project,
      "-f",
      existsSync(compose) ? compose : join(repo, "tests/wp/compose.yml"),
      "down",
      "-v",
      "--remove-orphans",
    ]);
    for (const file of [
      receiptFile,
      ownerFile,
      join(dirname(harness), ".harness-state"),
    ])
      rmSync(file, { force: true });
    console.log(
      "Showcase stopped. Its disposable database and uploads were removed.",
    );
    return;
  }
  if (command !== "up")
    throw new Error("Usage: node examples/showcase/run.mjs [up|check|down]");
  prerequisites("up");
  await verifyPort(verifyOwnership());
  mkdirSync(state, { recursive: true, mode: 0o700 });
  run("cargo", ["build", "--locked", "--quiet"]);
  const zero = resolve(
    repo,
    process.env.CARGO_TARGET_DIR ?? "target",
    "debug/zero",
  );
  mkdirSync(app, { recursive: true });
  copyFileSync(join(example, "zero.config.ts"), join(app, "zero.config.ts"));
  copyFileSync(join(example, "pantry.ts"), join(app, "pantry.ts"));
  cpSync(join(example, "public"), join(app, "public"), { recursive: true });
  run(zero, ["build", app, "--quiet"]);
  mkdirSync(join(app, "public/client"), { recursive: true });
  for (const name of ["index", "schema"]) {
    const source = readFileSync(join(app, `zero/client/${name}.ts`), "utf8");
    writeFileSync(
      join(app, `public/client/${name}.js`),
      nodeModule
        .stripTypeScriptTypes(source)
        .replace(/(from\s+["']\.\/[\w-]+)\.ts(["'])/g, "$1.js$2"),
    );
  }
  copyFileSync(
    join(app, "zero/client/LICENSE"),
    join(app, "public/client/LICENSE"),
  );
  copyFileSync(join(app, "zero.config.ts"), join(app, "public/source.ts.txt"));
  copyFileSync(join(app, "pantry.ts"), join(app, "public/pantry.ts.txt"));
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
  const classic = join(content, "plugins/zero-showcase-classic-admin");
  mkdirSync(classic, { recursive: true });
  copyFileSync(
    join(example, "classic-admin.php"),
    join(classic, "zero-showcase-classic-admin.php"),
  );
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
  // Resolve the existing harness configuration, then label every resource it creates.
  // JSON is valid YAML and avoids maintaining another Compose implementation.
  const configuration = JSON.parse(
    run(
      "docker",
      ["compose", "-p", project, "-f", compose, "config", "--format", "json"],
      {
        stdio: "pipe",
        encoding: "utf8",
      },
    ),
  );
  for (const resources of [
    configuration.services,
    configuration.volumes,
    configuration.networks,
  ]) {
    for (const resource of Object.values(resources ?? {}))
      resource.labels = { ...resource.labels, [ownerLabel]: ownerId };
  }
  writeFileSync(compose, JSON.stringify(configuration, null, 2));
  mkdirSync(join(state, "harness/fixtures"), { recursive: true });
  copyFileSync(
    join(repo, "tests/fixtures/platform.json"),
    join(state, "harness/fixtures/platform.json"),
  );
  await verifyPort(verifyOwnership());
  writeFileSync(ownerFile, JSON.stringify({ project, port, publicUrl }), {
    mode: 0o600,
  });
  chmodSync(ownerFile, 0o600);
  const output = run("bash", [harness, "up", "--wp-content", content], {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  const saved = { ...JSON.parse(output.trim()), project, port, url: publicUrl };
  wp("option", "update", "home", publicUrl);
  wp("option", "update", "siteurl", publicUrl);
  writeFileSync(receiptFile, JSON.stringify(saved, null, 2), { mode: 0o600 });
  chmodSync(receiptFile, 0o600);
  wp("plugin", "activate", "zero-showcase-classic-admin");
  wp("option", "update", "blogname", "Zero showcase");
  await seed(saved);
  await check(saved);
  show(saved);
}

main().catch((error) => {
  console.error(`Showcase failed: ${error.message}`);
  if (existsSync(ownerFile))
    console.error(
      `A showcase may still own resources. Inspect it, retry with ${invocation}, or remove it with: ${invocation} down`,
    );
  process.exitCode = 1;
});
