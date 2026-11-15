// Lets another machine open the site `first dev` is serving.
//
// `first dev` listens on this machine's loopback only, and WordPress writes its own address
// (http://localhost:8960) into every page. This forwards requests to it and rewrites that address
// in text answers to the one the reader used.
//
//   node share.mjs                          listens on 127.0.0.1:8961, forwards to localhost:8960
//   PUBLIC=https://box.example.ts.net:8960 node share.mjs
//
// Put `tailscale serve --bg --https=8960 http://127.0.0.1:8961` in front for a tailnet address.
import { createServer, request } from "node:http";

const upstream = new URL(process.env.UPSTREAM ?? "http://localhost:8960");
const port = Number(process.env.PORT ?? 8961);
const fixed = process.env.PUBLIC?.replace(/\/$/, "");
const text = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg)/;

createServer((req, res) => {
  const origin = fixed ?? `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers["x-forwarded-host"] ?? req.headers.host}`;
  const swap = (s) => s.replaceAll(upstream.origin, origin)
    .replaceAll(upstream.origin.replaceAll("/", "\\/"), origin.replaceAll("/", "\\/"))
    .replaceAll(encodeURIComponent(upstream.origin), encodeURIComponent(origin));
  // WordPress must keep seeing its own address, or it writes a third one (https://localhost:8960).
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !name.startsWith("x-forwarded-") && !name.startsWith("tailscale-")));
  Object.assign(headers, { host: upstream.host, "accept-encoding": "identity" });
  const out = request({ hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers }, (back) => {
    const head = { ...back.headers };
    delete head.host;
    for (const name of ["location", "link"]) if (typeof head[name] === "string") head[name] = swap(head[name]);
    if (!text.test(String(head["content-type"] ?? ""))) {
      res.writeHead(back.statusCode, head);
      back.pipe(res);
      return;
    }
    const parts = [];
    back.on("data", (part) => parts.push(part));
    back.on("end", () => {
      const body = Buffer.from(swap(Buffer.concat(parts).toString("utf8")));
      delete head["transfer-encoding"];
      head["content-length"] = String(body.length);
      res.writeHead(back.statusCode, head);
      res.end(body);
    });
  });
  out.on("error", (error) => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`The dev site at ${upstream.origin} did not answer: ${error.message}\n`);
  });
  req.pipe(out);
}).listen(port, "127.0.0.1", () => console.log(`forwarding http://127.0.0.1:${port} to ${upstream.origin}`));
