// spec.md §6: the site's users aren't listed to the public. Every route WordPress ships that lets a
// visitor enumerate users (by login, id or email) is closed while a First app is active, for every
// request form; signed-in users and credentials keep core's answers; `publicAuthors: true` opens them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auth, core, harness, wp, type Role } from "../env.ts";

const site = harness.url;
const get = (path: string, headers: Record<string, string> = {}) => fetch(`${site}${path}`, { redirect: "manual", headers });
const admin = harness.users.admin.id;
const login = "admin";
const post = Number(wp("post", "create", "--post_type=post", "--post_title=Byline", "--post_status=publish", `--post_author=${admin}`, "--porcelain"));
const slug = wp("post", "get", String(post), "--field=post_name");

/** Every route that names users to an anonymous visitor, with what it answers when closed. */
const ROUTES: [what: string, path: string][] = [
  ["the users list", "/wp-json/wp/v2/users"],
  ["one user", `/wp-json/wp/v2/users/${admin}`],
  ["the users list through ?rest_route=", "/?rest_route=/wp/v2/users"],
  ["one user through index.php?rest_route=", `/index.php?rest_route=/wp/v2/users/${admin}`],
  ["another letter case and a trailing slash", "/wp-json/WP/V2/Users/"],
  ["a search", "/wp-json/wp/v2/users?search=adm"],
  ["?author=<id>", `/?author=${admin}`],
  ["?author_name=", `/?author_name=${login}`],
  ["the author archive", `/author/${login}/`],
  ["the author archive's feed", `/author/${login}/feed/`],
  ["the author archive's Markdown twin", `/author/${login}.md`],
  ["the users sitemap", "/wp-sitemap-users-1.xml"],
];

async function closed(path: string, headers: Record<string, string> = {}) {
  const res = await get(path, headers);
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location"), body };
}

test("anonymous: no route names a user, in any request form", async () => {
  for (const [what, path] of ROUTES) {
    const res = await closed(path);
    assert.ok([401, 404].includes(res.status), `${what}: ${res.status} ${res.location ?? ""}`);
    assert.equal(res.location, null, `${what} doesn't redirect to the login`);
    assert.doesNotMatch(res.body, new RegExp(`"slug":"${login}"|/author/${login}/|admin@example\\.test`), what);
  }
  const index = await (await get("/wp-sitemap.xml")).text();
  assert.doesNotMatch(index, /wp-sitemap-users/, "the sitemap index lists no users sitemap");
  // The batch endpoint runs the same route.
  const batch = await fetch(`${site}/wp-json/batch/v1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requests: [{ method: "GET", path: "/wp/v2/users" }] }) });
  assert.doesNotMatch(await batch.text(), new RegExp(`"slug":"${login}"`));
  // A method override doesn't turn the read into something else.
  const overridden = await closed("/wp-json/wp/v2/users?_method=GET", {});
  assert.ok([401, 404].includes(overridden.status));
});

test("anonymous: a post's oEmbed and its REST author embed reveal no login", async () => {
  const embed = await (await get(`/wp-json/oembed/1.0/embed?url=${encodeURIComponent(`${site}/${slug}/`)}`)).json();
  assert.equal(embed.author_name, wp("option", "get", "blogname"), "the site's name, as core answers for a post with no author");
  assert.equal(embed.author_url, `${site}`);
  const posts = await (await get(`/wp-json/wp/v2/posts?include=${post}&_embed=author`)).json();
  const author = posts[0]._embedded?.author?.[0];
  assert.ok(author === undefined || author.code === "rest_user_cannot_view", JSON.stringify(author));
  // The facade's built-in users kind agrees with core's route.
  const facade = await get("/__first/api/v1/users");
  assert.equal(facade.status, 401);
});

test("signed in: core's own answers stay (the block editor lists authors)", async () => {
  for (const who of ["subscriber", "editor", "admin"] as Role[]) {
    const res = await fetch(`${core}/users/${admin}`, { headers: auth(who) });
    assert.equal(res.status, 200, who);
  }
  // What the block editor asks for its author picker.
  const editors = await fetch(`${core}/users?who=authors&context=view`, { headers: auth("editor") });
  assert.equal(editors.status, 200);
  const subscriberList = await fetch(`${core}/users?context=edit`, { headers: auth("subscriber") });
  assert.equal(subscriberList.status, 403, "core's own rule for lower roles");
});

test("a scoped agent credential without personal data sees no account details", async () => {
  const out = JSON.parse(wp("first", "identity", "agent", "add", "admin", `--name=authors-${Date.now()}`)).data;
  const header = { Authorization: "Basic " + btoa(`admin:${out.password}`) };
  const user = await (await fetch(`${core}/users/${admin}?context=edit`, { headers: header })).json();
  assert.deepEqual([user.email, user.username], [undefined, undefined]);
  wp("first", "identity", "agent", "revoke", "admin", out.id);
});

test("publicAuthors: true keeps them as WordPress ships them", async () => {
  const schema = wp("eval", "echo First\\Wp\\Runtime::plugin()->dir . '/first/app/schema.php';");
  const original = wp("eval", `echo base64_encode(file_get_contents('${schema}'));`);
  wp("eval", `file_put_contents('${schema}', str_replace(["    'admin' => false,\\n", "    'admin' => true,\\n"], ["    'admin' => false,\\n    'publicAuthors' => true,\\n", "    'admin' => true,\\n    'publicAuthors' => true,\\n"], file_get_contents('${schema}')));`);
  try {
    assert.equal((await fetch(`${harness.url}/__first/api/v1`, { headers: auth("admin") }).then((r) => r.json())).data.runtime.wp.publicAuthors, true);
    assert.equal((await get("/wp-json/wp/v2/users")).status, 200);
    assert.equal((await get(`/author/${login}/`)).status, 200);
    assert.equal((await get(`/?author=${admin}`)).status, 301);
    assert.equal((await get("/wp-sitemap-users-1.xml")).status, 200);
    const embed = await (await get(`/wp-json/oembed/1.0/embed?url=${encodeURIComponent(`${site}/${slug}/`)}`)).json();
    assert.equal(embed.author_url, `${site}/author/${login}/`);
  } finally {
    wp("eval", `file_put_contents('${schema}', base64_decode('${original}'));`);
  }
  assert.equal((await get("/wp-json/wp/v2/users")).status, 401, "closed again");
});
