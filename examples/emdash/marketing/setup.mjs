import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
export const first = resolve(process.env.FIRST_BIN ?? "target/debug/first");
export const command = async (args) =>
  (
    await exec(first, args, { timeout: 600000, maxBuffer: 8 * 1024 * 1024 })
  ).stdout.trim();
export const wp = (project, ...args) =>
  command(['wp', '--site', project, ...args]);
export async function installFrontend(project) {
  const site = join(project, ".first/dev/wordpress");
  await cp(
    join(here, "wordpress/first-marketing-frontend"),
    join(site, "wp-content/plugins/first-marketing-frontend"),
    { recursive: true },
  );
  await wp(project, "plugin", "activate", "first-marketing-frontend");
}
export async function connect(project) {
  const status = JSON.parse(await command(["dev", "status", project]));
  assert.equal(status.isOnline, true, "Start first dev before setup");
  const base = status.siteUrl.replace(/\/$/, "");
  const credentialName = `marketing-local-${randomUUID()}`;
  const password = await wp(
    project,
    "user",
    "application-password",
    "create",
    "admin",
    credentialName,
    "--porcelain",
  );
  const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  async function request(
    path,
    { method = "GET", body, auth = true, expected, headers = {} } = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(auth ? { authorization } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const result = await response.json();
    if (expected !== undefined)
      assert.equal(response.status, expected, JSON.stringify(result));
    else
      assert.ok(
        response.ok,
        `${method} ${path}: ${response.status} ${JSON.stringify(result)}`,
      );
    return result.data ?? result;
  }
  return {
    base,
    authorization,
    request,
    api: (path, options) => request("/__first/api/v1" + path, options),
    dispose: async () => {
      const list = JSON.parse(
        await wp(
          project,
          "user",
          "application-password",
          "list",
          "admin",
          "--format=json",
        ),
      );
      const own = list.find((item) => item.name === credentialName);
      if (own)
        await wp(
          project,
          "user",
          "application-password",
          "delete",
          "admin",
          own.uuid,
        );
    },
  };
}

// Seed only absent pages and an unset site global. Re-running setup preserves editorial changes.
export async function setup(project, { seedFile = join(here, "seed.json") } = {}) {
  await installFrontend(project);
  const client = await connect(project);
  try {
    return await seed(client, seedFile);
  } catch (error) {
    await client.dispose();
    throw error;
  }
}

async function seed(client, seedFile) {
  const seed = JSON.parse(await readFile(seedFile, "utf8"));
  const media = new Map();
  async function materialize(value) {
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value) result.push(await materialize(item));
      return result;
    }
    if (value && typeof value === "object") {
      if ("$media" in value) {
        const source = value.$media;
        if (!media.has(source.url)) {
          const downloaded = await fetch(source.url, {
            signal: AbortSignal.timeout(90000),
          });
          assert.ok(
            downloaded.ok,
            `Download ${source.filename}: ${downloaded.status}`,
          );
          const upload = await fetch(client.base + "/wp-json/wp/v2/media", {
            method: "POST",
            headers: {
              authorization: client.authorization,
              "content-type": downloaded.headers.get("content-type"),
              "content-disposition": `attachment; filename="${source.filename}"`,
            },
            body: Buffer.from(await downloaded.arrayBuffer()),
            signal: AbortSignal.timeout(90000),
          });
          const result = await upload.json();
          assert.equal(upload.status, 201, JSON.stringify(result));
          await client.request(`/wp-json/wp/v2/media/${result.id}`, {
            method: "POST",
            body: { alt_text: source.alt },
          });
          media.set(source.url, result.id);
        }
        return media.get(source.url);
      }
      const result = {};
      for (const [key, item] of Object.entries(value))
        result[key] = await materialize(item);
      return result;
    }
    return value;
  }
  const current = await client.api("/site");
  if (!current.identity && !current.navigation && !current.footer)
    await client.api("/site", { method: "PATCH", body: seed.site });
  const existing = await client.api("/pages");
  const pages = [];
  for (const source of seed.pages) {
    const found = existing.find((page) => page.slug === source.slug);
    if (found) {
      pages.push(found);
      continue;
    }
    const page = await materialize(source);
    const saved = await client.request("/wp-json/wp/v2/first_pages", {
      method: "POST",
      body: {
        title: page.title,
        slug: page.slug,
        status: "publish",
        acf: {
          first_sections: page.sections.map(({ layout, ...fields }) => ({
            acf_fc_layout: layout,
            ...fields,
          })),
        },
      },
    });
    pages.push(await client.api(`/pages/${saved.id}`));
  }
  return { ...client, pages };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const project = resolve(process.argv[2] ?? here);
  const client = await setup(project);
  try {
    console.log(
      `Marketing ready: ${client.base}/, /pricing, /contact, /about; native editing: ${client.base}/wp-admin/`,
    );
  } finally {
    // Leave existing application passwords alone; only revoke this setup session.
    await client.dispose();
  }
}
