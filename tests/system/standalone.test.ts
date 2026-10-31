// The standalone half of the system suite: examples/site built with `zero build --target standalone`,
// served by `php -S`, users and tokens minted through the built app's own CLI, and the same journey
// as WordPress through the same generated client. Standalone has no wp-admin, so the "editor"
// surface is the client itself; scheduled posts publish under a server whose clock is later
// (ZERO_NOW); the upgrade rebuilds into the same app directory and the app migrates on its next request.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer, connect } from "node:net";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client } from "../../examples/site/zero/client/index.ts";
import { siteJourney, type Role } from "./journey.ts";
import { clientOf, copySite, doctor, failing, receiver, sync, upgrade, work, zero } from "./project.ts";

const php = process.env.PHP ?? "php";
const project = join(work, "standalone-site");
const app = join(work, "standalone-app");
const tokens: Partial<Record<Role, string>> = {};
const servers: ChildProcess[] = [];
const hookSecret = `whsec_${Date.now().toString(36)}`;
const hook = await receiver(hookSecret);
// The site owner points the comment webhook at the moderation tool: env() reads the process environment.
const siteEnv = { SITE_HOOK_URL: `http://127.0.0.1:${hook.port}/hook`, SITE_HOOK_SECRET: hookSecret };
let base = "";
let authorId = 0;
let authorUser = 0;

function cli(...args: string[]): any {
  const out = JSON.parse(execFileSync(php, [join(app, "zero/bin/zero.php"), ...args], { encoding: "utf8", env: { ...process.env, ...siteEnv } }));
  assert.ok("data" in out, JSON.stringify(out));
  return out.data;
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** `php -S` on the app (optionally with a pinned clock); resolves once it accepts connections. */
async function serve(env: Record<string, string> = {}): Promise<string> {
  const port = await freePort();
  servers.push(spawn(php, ["-S", `127.0.0.1:${port}`, "-t", join(app, "public"), join(app, "public/index.php")], {
    cwd: app, env: { ...process.env, ...siteEnv, ...env }, stdio: "ignore",
  }));
  const deadline = Date.now() + 10_000;
  for (;;) {
    const up = await new Promise<boolean>((resolve) => {
      const sock = connect(port, "127.0.0.1", () => { sock.end(); resolve(true); });
      sock.on("error", () => resolve(false));
    });
    if (up) return `http://127.0.0.1:${port}`;
    assert.ok(Date.now() < deadline, "php -S didn't start");
    await new Promise((r) => setImmediate(r));
  }
}

const options = (role: Role, url = base) => ({ url: `${url}/api`, ...(role === "anonymous" ? {} : { token: tokens[role] }) });
const client = (role: Role, url = base): Client => createClient(options(role, url));

before(async () => {
  copySite(project);
  rmSync(app, { recursive: true, force: true });
  zero("build", project, "--target", "standalone", "--out", app, "--quiet");
  // The site's users are its `members` (an auth collection), named by email.
  for (const role of ["subscriber", "author", "editor", "admin"] as const) {
    const id = cli("user", "add", `${role}@example.test`, "--role", role).id;
    tokens[role] = cli("token", "create", `${role}@example.test`).token;
    if (role === "author") authorUser = id;
  }
  const userId = authorUser;
  [{ id: authorId }] = cli("insert", "authors", JSON.stringify({ name: "Ada Author", userId }));
  base = await serve();
  assert.deepEqual(failing(doctor(project, "--target", "standalone", "--out", app, "--site", base)), []);
});

after(() => {
  for (const s of servers) s.kill();
  hook.close();
});

test("the site journey on standalone", async (t) => {
  const editor = client("editor");
  await siteJourney(
    {
      target: "standalone",
      get origin() {
        return base;
      },
      client: (role) => client(role),
      get authorId() {
        return authorId;
      },
      editor: {
        async upload(bytes, type, filename, alt) {
          return (await editor.media.upload(new Blob([bytes], { type }), { filename, alt })).id;
        },
        async saveDraft({ ...p }) {
          return (await editor.posts.create({ ...p, status: "draft" })).id;
        },
        async publish(id) {
          await editor.posts.update(id, { status: "published" });
        },
      },
      async runJobs() {
        cli("jobs", "work", "--once");
      },
      sync: (dir) => sync(dir, ["--site", base, "--token", tokens.editor!]),
      async runRetries() {
        for (const { id } of cli("jobs", "list", "--state=failed")) cli("jobs", "run", id);
      },
      deliveries: hook.deliveries,
      async promoteDue(at) {
        // Time travel: a second server on the same database with its clock past `at`.
        const later = await serve({ ZERO_NOW: new Date(Date.parse(at) + 1000).toISOString() });
        return client("anonymous", later);
      },
      async signIn(email, password) {
        // The client this build generated: sign-in is per target (password here, redirects on WP).
        const { createClient: standaloneClient } = await import(pathToFileURL(join(project, "zero/client/index.ts")).href);
        const reader: Client = standaloneClient({ url: `${base}/api` });
        await reader.auth.login(email, password);
        return reader;
      },
      async upgrade() {
        // A redeploy: stop serving, rebuild into the same app directory, start again. With nothing
        // serving, the new migration is pending until the app's first request applies it.
        for (const s of servers.splice(0)) s.kill();
        upgrade(project);
        zero("build", project, "--target", "standalone", "--out", app, "--quiet");
        assert.deepEqual(failing(doctor(project, "--target", "standalone", "--out", app)), ["pending migrations"]);
        base = await serve();
        const as = await clientOf(project, (make, role) => make(options(role)));
        await as("anonymous").globals.settings.get();
        assert.deepEqual(failing(doctor(project, "--target", "standalone", "--out", app, "--site", base)), []);
        return as;
      },
    },
    t,
  );
});
