// Usage: node serve-static.mjs <dir>
// A plain static file server, as GitHub Pages answers: `/x` is x.html, `/x/` x/index.html,
// a missing file the site's 404.html with a 404, nothing else. Prints one JSON line ({url}) once it
// listens, then serves until killed. For browser tests of `typedpress export` output.
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2]);
const types = { ".html": "text/html; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".xml": "application/xml", ".json": "application/json", ".woff2": "font/woff2" };
const send = (response, status, file) => {
  response.writeHead(status, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).on("error", () => response.destroy()).pipe(response);
};
const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname); } catch { return response.writeHead(400).end(); }
  let file = path.join(root, path.normalize(pathname));
  if (file !== root && !file.startsWith(root + path.sep)) return response.writeHead(400).end();
  // `/docs/guides` is docs/guides.html even when docs/guides/ is a folder too (GitHub Pages, Netlify
  // and Cloudflare Pages answer it that way); a folder alone serves its index.html.
  if (!pathname.endsWith("/") && existsSync(`${file}.html`)) file = `${file}.html`;
  else if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (existsSync(file) && statSync(file).isFile()) return send(response, 200, file);
  const missing = path.join(root, "404.html");
  if (existsSync(missing)) return send(response, 404, missing);
  response.writeHead(404).end();
});
server.listen(0, "127.0.0.1", () => process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` }) + "\n"));
