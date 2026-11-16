// spec.md §6: the site's users aren't listed to the public. Every route WordPress ships that lets a
// visitor enumerate users (by login, id or email) is closed while a TypedPress app is active, for every
// request form; signed-in users and credentials keep core's answers; `publicAuthors: true` opens them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, auth, core, harness, wp, type Role } from "../env.ts";
import { loginCookie } from "../login.ts";

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
  // The batch endpoint runs the same route for its sub-requests (it takes writes only): the batch
  // answers, and the sub-request holds the refusal.
  const batch = await fetch(`${site}/wp-json/batch/v1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requests: [{ method: "POST", path: `/wp/v2/users/${admin}`, body: { name: "x" } }] }) });
  const batched = await batch.json();
  assert.deepEqual([batch.status, batched.responses?.[0]?.status, batched.responses?.[0]?.body?.code], [207, 401, "rest_user_cannot_view"], JSON.stringify(batched));
  // HEAD is the read without its body.
  assert.equal((await fetch(`${core}/users`, { method: "HEAD" })).status, 401);
  // More forms of the archive query: an array, a negative id, a feed by id, a second page.
  for (const path of [`/?author[]=${admin}`, `/?author=-${admin}`, `/?feed=rss2&author=${admin}`, `/author/${login}/page/2/`, `/?author=${admin},${harness.users.editor.id}`]) {
    const res = await closed(path);
    assert.equal(res.status, 404, path);
    assert.equal(res.location, null, path);
  }
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
  const facade = await get("/__tp/api/v1/users");
  assert.equal(facade.status, 401);
});

test("a guest session is a visitor: core's users routes stay closed to it", async () => {
  // Anyone can start a guest session without credentials, so it must not count as signed in here.
  const started = await fetch(`${api}/auth/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const guest = (await started.json()).data;
  assert.equal(started.status, 201, JSON.stringify(guest));
  const bearer = { Authorization: `Bearer ${guest.accessToken}` };
  for (const path of ["/wp-json/wp/v2/users", `/wp-json/wp/v2/users/${admin}`, `/wp-json/wp/v2/users?search=adm`, `/wp-json/wp/v2/posts?include=${post}&_embed=author`]) {
    const res = await get(path, bearer);
    const body = await res.text();
    assert.doesNotMatch(body, new RegExp(`"slug":"${login}"`), path);
    // 403, not 401: the guest is authenticated, and still isn't allowed.
    if (path.includes("/users")) assert.equal(res.status, 403, path);
  }
  // The guest still reads its own record, through TypedPress's API and on core's own route.
  const me = await (await fetch(`${api}/me`, { headers: bearer })).json();
  assert.equal(me.data.id, guest.user.id);
  const own = await fetch(`${core}/users/me`, { headers: bearer });
  assert.deepEqual([own.status, (await own.json()).id], [200, guest.user.id]);
});

test("what isn't an author archive keeps working: REST's own author parameters, OPTIONS, an empty author", async () => {
  // `author` and `author_name` are public query vars, so WordPress copies them into a REST request's
  // vars too; there they are the route's own parameters, for visitors and signed-in users alike.
  for (const headers of [{}, auth("editor")]) {
    for (const path of [`/wp-json/wp/v2/posts?author=${admin}`, `/?rest_route=/wp/v2/posts&author=${admin}`, `/wp-json/wp/v2/posts?author[]=${admin}`]) {
      const res = await get(path, headers);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/, path);
      assert.ok(Array.isArray(await res.json()), path);
    }
  }
  // A CORS preflight carries no credentials: core's route description answers, and names no user.
  const options = await fetch(`${core}/users`, { method: "OPTIONS" });
  assert.equal(options.status, 200);
  assert.doesNotMatch(await options.text(), new RegExp(`"slug":"${login}"`));
  // An empty author is no author query, as in core: the home page.
  for (const path of ["/?author=", "/?author=0"]) assert.equal((await get(path)).status, 200, path);
});

test("the front-end pages answer the same for everyone, so a cache can hold them", async () => {
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  assert.equal((await get(`/author/${login}/`, { cookie })).status, 404);
  assert.equal((await get(`/?author=${admin}`, { cookie })).status, 404);
  // wp-admin's own list filtered by author still works.
  assert.equal((await get(`/wp-admin/edit.php?author=${admin}`, { cookie })).status, 200);
});

test("a registered commenter's login isn't printed in the page", async () => {
  // WordPress derives a user's nicename from the login and prints it as a class on their comments.
  wp("comment", "create", `--comment_post_ID=${post}`, "--comment_content=Signed", `--user_id=${admin}`, "--comment_approved=1");
  const page = await (await fetch(`${site}/${slug}/`)).text();
  assert.match(page, /Signed/, "the comment is on the page");
  assert.match(page, /\bbyuser\b/, "core's other comment classes stay");
  assert.doesNotMatch(page, new RegExp(`comment-author-${login}\\b|/author/${login}/`));
  // A byline's link to the archive (what core's author blocks print) points at the home page.
  assert.equal(wp("eval", `echo get_author_posts_url(${admin});`), `${site}/`);
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
  const out = JSON.parse(wp("typedpress", "identity", "agent", "add", "admin", `--name=authors-${Date.now()}`)).data;
  const header = { Authorization: "Basic " + btoa(`admin:${out.password}`) };
  const user = await (await fetch(`${core}/users/${admin}?context=edit`, { headers: header })).json();
  assert.deepEqual([user.email, user.username], [undefined, undefined]);
  wp("typedpress", "identity", "agent", "revoke", "admin", out.id);
});

test("publicAuthors: true keeps them as WordPress ships them", async () => {
  const schema = wp("eval", "echo TypedPress\\Wp\\Runtime::plugin()->dir . '/tp/app/schema.php';");
  const original = wp("eval", `echo base64_encode(file_get_contents('${schema}'));`);
  wp("eval", `file_put_contents('${schema}', str_replace(["    'admin' => false,\\n", "    'admin' => true,\\n"], ["    'admin' => false,\\n    'publicAuthors' => true,\\n", "    'admin' => true,\\n    'publicAuthors' => true,\\n"], file_get_contents('${schema}')));`);
  try {
    assert.equal((await fetch(`${harness.url}/__tp/api/v1`, { headers: auth("admin") }).then((r) => r.json())).data.runtime.wp.publicAuthors, true);
    assert.equal((await get("/wp-json/wp/v2/users")).status, 200);
    assert.equal((await get(`/author/${login}/`)).status, 200);
    assert.equal((await get(`/?author=${admin}`)).status, 301);
    assert.equal((await get("/wp-sitemap-users-1.xml")).status, 200);
    const discussed = await (await fetch(`${site}/${slug}/`)).text();
    assert.match(discussed, new RegExp(`comment-author-${login}\\b`), "the commenter class is core's again");
    assert.equal(wp("eval", `echo get_author_posts_url(${admin});`), `${site}/author/${login}/`);
    const embed = await (await get(`/wp-json/oembed/1.0/embed?url=${encodeURIComponent(`${site}/${slug}/`)}`)).json();
    assert.equal(embed.author_url, `${site}/author/${login}/`);
  } finally {
    wp("eval", `file_put_contents('${schema}', base64_decode('${original}'));`);
  }
  assert.equal((await get("/wp-json/wp/v2/users")).status, 401, "closed again");
});
