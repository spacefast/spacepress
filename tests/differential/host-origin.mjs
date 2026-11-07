// The HTTP origin for host-globals.ts: Node's fetch calls it directly and the PHP run reaches it
// through stubbed WordPress HTTP functions, so both sides read the same answers. Prints its port.
import { createServer } from "node:http";

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    switch (req.url) {
      case "/json":
        res.writeHead(200, { "content-type": "application/json", "x-origin": "ok", "x-accept": req.headers.accept ?? "" });
        return res.end(JSON.stringify({ hello: "world" }));
      case "/text":
        res.writeHead(418, { "content-type": "text/plain", "x-type": req.headers["content-type"] ?? "" });
        return res.end(`${req.method} ${body}`);
      case "/redirect":
        return res.writeHead(302, { location: "/json" }).end();
      default:
        return res.writeHead(404).end("missing");
    }
  });
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
