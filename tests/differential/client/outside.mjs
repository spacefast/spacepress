// Usage: node outside.mjs <url> <user:application password> <client dir>
// The app's generated client outside WordPress (Node, another origin): `fetch` and the site's REST
// root, signed in with an application password, and as a visitor with no credential. Every request
// is recorded by method and path, so the test sees each operation go to core's ability run route.
// Prints JSON.
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const [url, password, clientDir] = process.argv.slice(2);
const paths = [];
const caching = new Set();
const recording = async (input, init) => {
  const u = new URL(String(input));
  paths.push(`${init?.method ?? "GET"} ${u.pathname}`);
  const res = await fetch(input, init);
  // Every run of the app's abilities is private: no shared cache keeps one visitor's answer.
  if (u.pathname.includes("/wp-abilities/") && res.ok) {
    const control = (res.headers.get("cache-control") ?? "").split(",").map((d) => d.trim());
    const vary = (res.headers.get("vary") ?? "").split(",").map((d) => d.trim().toLowerCase());
    caching.add(control.includes("private") && control.includes("no-store") && ["origin", "cookie", "authorization"].every((h) => vary.includes(h)) ? "private" : `shared: ${res.headers.get("cache-control")} | ${res.headers.get("vary")}`);
  }
  return res;
};
const { createClient, SpacePressError } = await import(pathToFileURL(join(clientDir, "index.ts")).href);
const authorization = `Basic ${Buffer.from(password).toString("base64")}`;
const agent = createClient({ url: `${url}/wp-json`, fetch: recording, headers: { Authorization: authorization } });
const visitor = createClient({ url, fetch: recording });
const typed = (e) => ({ typed: e instanceof SpacePressError, status: e.status, code: e.code });

// A wrong application password is refused, never read as a visitor.
const wrong = await createClient({ url: `${url}/wp-json`, fetch: recording, headers: { Authorization: `Basic ${Buffer.from(`${password.split(":")[0]}:nope`).toString("base64")}` } })
  .guestbook.list().catch(typed);
const before = await agent.guestbook.list();
const made = await agent.guestbook.create({ name: "From Node" });
const after = await agent.guestbook.list({ orderBy: { id: "asc" } });
const page = await agent.guestbook.paginate({ limit: 1, orderBy: { id: "asc" } });
const liked = await agent.actions.like({ postId: 41 });
const me = await agent.auth.me();
// A validation error from WordPress's schema check reaches the caller as the client's typed error.
const refused = await agent.actions.like({ postId: "not a number" }).catch(typed);

// A visitor: reads and the `anyone` action work, `me` is null, an admin-only write is refused.
const visitorRead = await visitor.guestbook.list();
const visitorLiked = await visitor.actions.like({ postId: 1 });
const visitorMe = await visitor.auth.me();
const visitorUpdate = await visitor.guestbook.update(made.id, { name: "Not yours" }).catch(typed);

process.stdout.write(JSON.stringify({
  before: before.map((r) => r.name),
  made: made.name,
  after: after.map((r) => r.name),
  page: { rows: page.rows.map((r) => r.name), cursor: page.cursor },
  liked,
  me: me && { name: me.name, role: me.role },
  refused,
  visitor: { read: visitorRead.map((r) => r.name), liked: visitorLiked, me: visitorMe, update: visitorUpdate },
  wrong,
  caching: [...caching],
  paths,
}));
