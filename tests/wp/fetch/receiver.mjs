// A disposable HTTPS origin for the fetch lane. It answers on 0.0.0.0 with a self-signed
// certificate for `fetch-origin.test`; the WordPress container trusts only that CA, only for that
// name (tests/wp/fetch/mu-plugin.php). Prints its port, then serves until killed.
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:https";

const [key, cert, log] = process.argv.slice(2);
const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "https://fetch-origin.test");
    appendFileSync(log, JSON.stringify({ method: req.method, path: url.pathname, headers: req.headers, body }) + "\n");
    switch (url.pathname) {
      case "/json":
        res.writeHead(200, { "content-type": "application/json", "x-origin": "ok", "set-cookie": "a=b" });
        return res.end(JSON.stringify({ hello: "world", method: req.method, received: body }));
      case "/text":
        return res.writeHead(418, { "content-type": "text/plain" }).end("short and stout");
      case "/redirect":
        return res.writeHead(302, { location: "/json" }).end();
      case "/see-other":
        return res.writeHead(303, { location: "/json" }).end();
      case "/loop":
        return res.writeHead(302, { location: "/loop" }).end();
      case "/to-loopback":
        return res.writeHead(302, { location: "https://127.0.0.1/json" }).end();
      case "/to-metadata":
        return res.writeHead(307, { location: "https://169.254.169.254/latest/meta-data/" }).end();
      case "/to-http":
        return res.writeHead(302, { location: `http://fetch-origin.test:${server.address().port}/json` }).end();
      case "/big":
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end(Buffer.alloc(1048577, 97));
      case "/slow":
        return setTimeout(() => res.writeHead(200).end("late"), 15000);
      default:
        return res.writeHead(404).end("missing");
    }
  });
});
server.listen(0, "0.0.0.0", () => console.log(server.address().port));
