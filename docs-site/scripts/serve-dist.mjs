// Serves dist/ for the browser tests: static files, `.wasm` with its own media type so the browser
// can compile it while it streams. (Astro's preview server daemonizes, which a test runner cannot wait on.)
// SITE_BASE mounts the build under a path, as GitHub Pages does for a project site.
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.env.PORT ?? 4321);
const base = (process.env.SITE_BASE ?? "/").replace(/\/+$/, "");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml",
};

/** The file a request names, or null when it is outside the site. */
function resolve(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  } catch {
    return null;
  }
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const file = path.join(dist, path.normalize(pathname.slice(base.length) || "/"));
  return file === dist || file.startsWith(`${dist}${path.sep}`) ? file : null;
}

http
  .createServer((request, response) => {
    let file = resolve(request.url ?? "/");
    if (file === null) return response.writeHead(400).end("bad request");
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file) || !statSync(file).isFile()) return response.writeHead(404).end("not found");
    response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  })
  .listen(port, "127.0.0.1", () => console.log(`serving ${dist} at http://127.0.0.1:${port}${base}/`));
