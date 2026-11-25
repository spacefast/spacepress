import http from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildApp,
  command,
  assertAdditive,
  assertAdditiveSql,
  sourceRevision,
  readAppSchema,
  assertStructuredFields,
} from "./build-app.mjs";

const terminal = new Set(["succeeded", "failed", "interrupted"]);
const socketFor = (state) => join(state, "control/control.sock");
const ownerFor = (state) => createHash("sha256").update(resolve(state)).digest("hex");
function atomicJson(file, value) {
  writeFileSync(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
  renameSync(file + ".tmp", file);
}
export function requestControl(state, method = "GET", path = "/control", body) {
  return new Promise((resolveRequest, reject) => {
    const request = http.request(
      {
        socketPath: socketFor(state),
        agent: false,
        path,
        method,
        headers: { "content-type": "application/json" },
        timeout: 6000,
      },
      (response) => {
        let result = "";
        response.on("error", reject);
        response.on("aborted", () => reject(new Error("Control response was interrupted")));
        response.on("data", (chunk) => {
          result += chunk;
          if (result.length > 65536) request.destroy(new Error("Oversized control response"));
        });
        response.on("end", () => {
          try {
            resolveRequest({ status: response.statusCode, body: JSON.parse(result) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("Control request timed out")));
    request.on("error", reject);
    request.end(body ? JSON.stringify(body) : undefined);
  });
}
export async function stopControl(state) {
  let result;
  try {
    result = await requestControl(state);
  } catch (error) {
    if (["ENOENT", "ECONNREFUSED"].includes(error.code)) {
      const journal = join(state, "builds");
      if (existsSync(journal))
        for (const id of readdirSync(journal)) {
          const file = join(journal, id, "job.json");
          if (!existsSync(file)) continue;
          const job = JSON.parse(readFileSync(file, "utf8"));
          if (job.recoveryRequired || job.status === "applying")
            throw new Error(
              "A previous Apply needs inspection. See the private builds journal before restarting.",
            );
        }
      return;
    }
    throw error;
  }
  if (result.body.owner !== ownerFor(state)) throw new Error("Refusing a foreign rebuild service.");
  if (result.body.recoveryRequired)
    throw new Error(
      "A previous Apply needs inspection. See the private builds journal before restarting.",
    );
  const stopped = await requestControl(state, "POST", "/shutdown");
  if (stopped.status !== 200) throw new Error(stopped.body.message);
}
export async function startControl(options) {
  const { state } = options;
  const control = join(state, "control");
  mkdirSync(control, { recursive: true, mode: 0o700 });
  chmodSync(control, 0o700);
  const socket = socketFor(state);
  if (existsSync(socket)) {
    if (!lstatSync(socket).isSocket())
      throw new Error("Control socket path is occupied by a non-socket.");
    try {
      const current = await requestControl(state);
      if (current.body.owner !== ownerFor(state)) throw new Error("Foreign rebuild service.");
      throw new Error("Rebuild service is already running.");
    } catch (error) {
      if (error.code !== "ECONNREFUSED") throw error;
      rmSync(socket);
    }
  }
  const service = join(state, "service");
  mkdirSync(service, { recursive: true, mode: 0o700 });
  chmodSync(service, 0o700);
  const config = join(service, "config.json");
  atomicJson(config, options);
  const log = openSync(join(service, "service.log"), "a", 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), config], {
    detached: true,
    stdio: ["ignore", log, log, "ipc"],
  });
  closeSync(log);
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Rebuild service startup timed out."));
    }, 10000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Rebuild service exited ${code}. Inspect ${service}/service.log.`));
    });
    child.once("message", (message) => {
      clearTimeout(timer);
      if (message.ready) resolveReady();
      else reject(new Error(message.error));
    });
  });
  child.disconnect();
  child.unref();
}

async function serve(options) {
  const { state, first, harness, env } = options;
  const app = join(state, "app");
  const jobsDir = join(state, "builds");
  await mkdir(jobsDir, { recursive: true, mode: 0o700 });
  const jobs = new Map();
  let active = null;
  let recoveryRequired = false;
  let stopping = false;
  const save = (job) => atomicJson(join(jobsDir, job.id, "job.json"), job);
  for (const id of await readdir(jobsDir)) {
    if (!/^[a-f0-9-]{36}$/.test(id)) continue;
    const job = JSON.parse(await readFile(join(jobsDir, id, "job.json"), "utf8"));
    if (!terminal.has(job.status)) {
      job.recoveryRequired = job.status === "applying";
      job.status = "interrupted";
      job.message = job.recoveryRequired
        ? "Apply was interrupted during publication. Inspect this build journal before rebuilding; no automatic replay was attempted."
        : "Compilation was interrupted. Your running demo is unchanged; submit again.";
      save(job);
    }
    if (job.recoveryRequired) recoveryRequired = true;
    jobs.set(id, job);
  }
  const baseline = () => {
    const source = join(app, "public/sources.json");
    const published = join(state, "wp-content/plugins/spacepress-app-showcase/public/sources.json");
    return JSON.parse(readFileSync(existsSync(source) ? source : published, "utf8"));
  };
  const wp = (args) => command("bash", [harness, "wp", ...args], { env, timeout: 90000 });
  async function build(request, job) {
    const dir = join(jobsDir, job.id);
    const candidate = join(dir, "app");
    let maintenance = false;
    let installed = false;
    let publicationStarted = false;
    let committed = false;
    let outcome;
    const live = join(state, "wp-content/plugins/spacepress-app-showcase");
    const backup = join(dir, "previous-plugin");
    const stage = join(dirname(live), `.showcase-${job.id}`);
    const log = (text) => {
      if (!text) return;
      job.log = ((job.log ?? "") + text + "\n").slice(-8000);
      save(job);
    };
    try {
      job.status = "building";
      job.message = "Compiling edited source and checking the migration.";
      save(job);
      const before = baseline();
      if (before.revision !== request.baseRevision)
        throw new Error("The demo changed. Reload the source before applying.");
      await mkdir(candidate, { recursive: true });
      await cp(join(app, "public"), join(candidate, "public"), { recursive: true });
      await cp(join(app, "sp"), join(candidate, "sp"), { recursive: true });
      const result = await buildApp({ app: candidate, first, files: request.files, log });
      assertAdditive(before.previous, result.manifest.previous);
      assertStructuredFields(
        await readAppSchema(join(app, "sp/dist/wp-content/plugins/spacepress-app-showcase")),
        await readAppSchema(result.plugin),
      );
      for (const name of result.manifest.migrationFiles) {
        if (before.migrationFiles.includes(name)) {
          if (result.manifest.output[`migrations/${name}`] !== before.output[`migrations/${name}`])
            throw new Error("A previous migration changed; Apply refused.");
        } else assertAdditiveSql(result.manifest.output[`migrations/${name}`]);
      }
      if (baseline().revision !== request.baseRevision)
        throw new Error("The demo changed during compilation. Reload before applying.");
      await cp(result.plugin, stage, { recursive: true });
      const maintenanceState = await wp([
        "eval",
        'echo file_exists(ABSPATH . ".maintenance") ? "active" : "inactive";',
        "--skip-plugins",
        "--skip-themes",
      ]);
      if (maintenanceState.trim() !== "inactive")
        throw new Error(
          "The demo is already in maintenance mode. Apply refused to take over that maintenance window.",
        );
      job.status = "applying";
      job.message = "Publishing the compiled plugin and applying added fields.";
      save(job);
      publicationStarted = true;
      maintenance = true;
      log(await wp(["maintenance-mode", "activate", "--skip-plugins", "--skip-themes"]));
      await rename(live, backup);
      await rename(stage, live);
      installed = true;
      log(await wp(["first", "migrate"]));
      // Keep the accepted source and its exact migration history together. The launcher
      // uses these files on future runs, rather than overwriting browser edits.
      await rename(app, join(dir, "previous-app"));
      await rename(candidate, app);
      atomicJson(join(state, "source-overrides.json"), request.files);
      committed = true;
      job.revision = result.manifest.revision;
      outcome = {
        status: "succeeded",
        message:
          "Applied. Existing records were retained. Reload the demo to use the new source and client.",
      };
    } catch (error) {
      log(error.stderr || error.message);
      if (publicationStarted && !committed) {
        recoveryRequired = true;
        job.recoveryRequired = true;
        try {
          const previousApp = join(dir, "previous-app");
          if (existsSync(previousApp)) {
            await rm(app, { recursive: true, force: true });
            await rename(previousApp, app);
          }
          if (existsSync(backup)) {
            if (installed) await rm(live, { recursive: true, force: true });
            await rename(backup, live);
          }
        } catch (restore) {
          log(`Plugin restore failed: ${restore.message}`);
        }
      }
      outcome = {
        status: "failed",
        message: recoveryRequired
          ? "Apply failed during publication. Previous plugin restoration was attempted; database changes are never automatically reversed. Further builds are blocked until the private build journal is inspected."
          : `Build rejected; the running demo is unchanged. ${error.message}`,
      };
    } finally {
      await rm(stage, { recursive: true, force: true }).catch((error) => log(error.message));
      if (maintenance) {
        try {
          log(await wp(["maintenance-mode", "deactivate", "--skip-plugins", "--skip-themes"]));
        } catch (error) {
          job.recoveryRequired = recoveryRequired = true;
          outcome = {
            status: "failed",
            message: "Maintenance cleanup failed. Inspect the build journal before using the demo.",
          };
          log(error.message);
        }
      }
      // A terminal result means publication AND maintenance cleanup have finished.
      Object.assign(job, outcome);
      save(job);
      active = null;
    }
  }
  const server = http.createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(body));
    };
    try {
      if (request.method === "GET" && request.url === "/control")
        return send(200, {
          owner: ownerFor(state),
          available: !recoveryRequired,
          recoveryRequired,
          revision: baseline().revision,
          activeBuild: active,
        });
      if (request.method === "POST" && request.url === "/shutdown") {
        if (active)
          return send(409, {
            message: "A build is active. Wait for its result before restarting the launcher.",
          });
        stopping = true;
        rmSync(socketFor(state), { force: true });
        send(200, { stopped: true });
        return server.close(() => process.exit(0));
      }
      if (request.method === "GET" && /^\/builds\/[a-f0-9-]{36}$/.test(request.url)) {
        const job = jobs.get(request.url.slice(8));
        return send(
          job ? 200 : 404,
          job ?? { message: "Build not found. Retry the same submission ID to reconcile it." },
        );
      }
      if (request.method !== "POST" || request.url !== "/builds")
        return send(404, { message: "Unknown route." });
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 1048576)
          return send(413, { message: "Source exceeds 1 MiB." });
      }
      if (stopping)
        return send(409, {
          message: "The launcher is restarting this demo. Retry after it finishes.",
        });
      let input;
      try {
        input = JSON.parse(body);
      } catch {
        return send(400, { message: "Invalid JSON." });
      }
      const current = baseline();
      const validId =
        typeof input?.id === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.id);
      if (
        !validId ||
        typeof input.baseRevision !== "string" ||
        !input.files ||
        typeof input.files !== "object" ||
        Array.isArray(input.files)
      )
        return send(400, { message: "Send an id, baseRevision and source files." });
      const names = Object.keys(current.files).sort();
      if (
        JSON.stringify(Object.keys(input.files).sort()) !== JSON.stringify(names) ||
        names.some((name) => !/^[\w.-]+\.ts$/.test(name) || typeof input.files[name] !== "string")
      )
        return send(400, { message: "Submit exactly the source files shown in the config lab." });
      const digest = sourceRevision({
        baseRevision: input.baseRevision,
        files: sourceRevision(input.files),
      });
      const existing = jobs.get(input.id);
      if (existing)
        return send(
          existing.digest === digest ? 200 : 409,
          existing.digest === digest
            ? existing
            : { message: "This build ID belongs to a different submission." },
        );
      if (recoveryRequired)
        return send(409, { message: "A previous publication needs inspection before rebuilding." });
      if (active)
        return send(409, { message: "Another build is active. Check its status before applying." });
      if (input.baseRevision !== current.revision)
        return send(409, { message: "The demo changed. Reload its source before applying." });
      const job = { id: input.id, digest, status: "queued", message: "Build queued." };
      mkdirSync(join(jobsDir, job.id), { mode: 0o700 });
      atomicJson(join(jobsDir, job.id, "request.json"), input);
      save(job);
      jobs.set(job.id, job);
      active = job;
      send(202, job);
      void build(input, job);
    } catch (error) {
      send(500, { message: error.message });
    }
  });
  server.requestTimeout = 15000;
  await new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(socketFor(state), ready);
  });
  chmodSync(socketFor(state), 0o600);
  process.send?.({ ready: true });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  serve(JSON.parse(readFileSync(process.argv[2], "utf8"))).catch((error) => {
    process.send?.({ error: error.message });
    console.error(error);
    process.exit(1);
  });
}
