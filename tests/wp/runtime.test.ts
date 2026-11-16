// Lane K1 (runtime gaps) on real WordPress. Pipeline edge cases are proven in tests/php; this file
// proves what Polylang and MySQL add.
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, auth, http, ok, qs, run, sql, wp, first } from "./env.ts";

const tree = (rows: any[]) => rows.map((r) => [`${r.locale}:${r.title}`, r.legs.map((l: any) => `${l.locale}:${l.title}`)]);

test("a generated object handler trims, updates and returns its validated input", async () => {
  assert.deepEqual(await ok("POST", "/actions/nativeHandler", { body: { title: "  A native handler  ", count: 1 } }),
    { title: "A native handler", count: 2 });
});

test("with: a localized `many` resolves to each parent row's locale through Polylang, falling back per group", async () => {
  const en = await ok("POST", "/tours", { as: "editor", body: { title: `Legs ${run}` } });
  const fr = await ok("POST", "/tours", { as: "editor", body: { title: `Legs FR ${run}`, locale: "fr", translationOf: en.id } });
  const harbour = await ok("POST", "/legs", { as: "editor", body: { title: "Harbour", tourId: en.id } });
  await ok("POST", "/legs", { as: "editor", body: { title: "Port", locale: "fr", translationOf: harbour.id } });
  await ok("POST", "/legs", { as: "editor", body: { title: "Castle", tourId: en.id } });
  // A leg can name either row of the group; it belongs to the whole group.
  await ok("POST", "/legs", { as: "editor", body: { title: "Garden", tourId: fr.id } });
  const both = await ok("GET", "/tours" + qs({ locale: "*", where: { id: { in: [en.id, fr.id] } }, orderBy: "id", with: { legs: { orderBy: { id: "asc" } } } }));
  assert.deepEqual(tree(both), [
    [`en:Legs ${run}`, ["en:Harbour", "en:Castle", "en:Garden"]],
    [`fr:Legs FR ${run}`, ["fr:Port", "en:Castle", "en:Garden"]],
  ]);
  // limit/offset window over the whole group's legs, in SQL (MariaDB), whichever row of the group asks.
  const paged = await ok("GET", "/tours" + qs({ locale: "*", where: { id: { in: [en.id, fr.id] } }, orderBy: "id", with: { legs: { orderBy: { id: "asc" }, limit: 2, offset: 1 } } }));
  assert.deepEqual(tree(paged), [[`en:Legs ${run}`, ["en:Castle", "en:Garden"]], [`fr:Legs FR ${run}`, ["en:Castle", "en:Garden"]]]);
  // No German tour: the en row stands in, and so do its en legs.
  const de = await ok("GET", "/tours" + qs({ locale: "de", where: { id: { in: [en.id, fr.id] } }, with: "legs" }));
  assert.deepEqual(tree(de), [[`en:Legs ${run}`, ["en:Harbour", "en:Castle", "en:Garden"]]]);
});

test("a bulk update over several rows of one translation group runs each row's hooks once", async () => {
  const en = await ok("POST", "/tours", { as: "editor", body: { title: `Bulk ${run}`, price: 1 } });
  const fr = await ok("POST", "/tours", { as: "editor", body: { title: `Bulk FR ${run}`, locale: "fr", translationOf: en.id } });
  const de = await ok("POST", "/tours", { as: "editor", body: { title: `Bulk DE ${run}`, locale: "de", translationOf: en.id } });
  assert.equal(await ok("POST", "/actions/bulkTourPrice", { as: "editor", body: { a: en.id, b: fr.id, price: 7 } }), 2);
  const log = await ok("GET", "/tour_log" + qs({ where: { tourId: { in: [en.id, fr.id, de.id] } }, orderBy: "id" }));
  assert.deepEqual(log.map((r: any) => `${r.tourId}=${r.entry}`).sort(), [`${en.id}=en:7 by Editor`, `${fr.id}=fr:7 by Editor`, `${de.id}=de:7 by Editor`].sort());
  const rows = await ok("GET", "/tours" + qs({ locale: "*", where: { id: { in: [en.id, fr.id, de.id] } } }));
  assert.deepEqual(rows.map((r: any) => r.price), [7, 7, 7]);
});

// Guest pruning (§6.2): `typedpress.prune-guests`, an Action Scheduler recurring action.
const guest = async () => {
  const res = await http("POST", `${api}/auth/guest`, {});
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.data;
};
/** Make a guest look inactive since $days ago: registration and every refresh token it was minted. */
const age = (id: number, days: number) => {
  sql(`UPDATE wp_users SET user_registered = UTC_TIMESTAMP() - INTERVAL ${days} DAY WHERE ID = ${id}`);
  sql(`UPDATE wp_tp_identity_tokens SET expires_at = expires_at - ${days * 86400} WHERE wp_user_id = ${id}`);
};
const user = (id: number) => sql(`SELECT ID FROM wp_users WHERE ID = ${id}`).length === 1;
const runPrune = () => {
  const [action] = sql("SELECT a.action_id FROM wp_actionscheduler_actions a JOIN wp_actionscheduler_groups g ON g.group_id = a.group_id WHERE a.hook = 'typedpress.prune-guests' AND a.status = 'pending' AND g.slug = 'typedpress'");
  assert.ok(action, "the recurring action is scheduled in group first");
  wp("action-scheduler", "action", "run", action.action_id);
};

test("first.prune-guests deletes stale guests with what they own, per onDelete, and keeps the rest", async () => {
  const [stale, pinned, fresh, author] = [await guest(), await guest(), await guest(), await guest()];
  const id = (g: any) => g.user.id as number;
  // Members are readable only to themselves; pruning fixtures use trusted setup.
  const cart = first("insert", "guest_carts", JSON.stringify({ memberId: id(stale) }))[0];
  const note = first("insert", "guest_notes", JSON.stringify({ body: "mine", memberId: id(stale) }))[0];
  // guestbook.memberId has no onDelete: the row still requires its guest.
  const entry = first("insert", "guestbook", JSON.stringify({ message: `pinned ${run}`, memberId: id(pinned) }))[0];
  // A post the guest authored stays, without an author.
  const post = Number(wp("post", "create", "--post_type=tp_posts", "--post_status=publish", `--post_title=Guest ${run}`, `--post_author=${id(author)}`, "--porcelain"));
  for (const g of [stale, pinned, author]) age(id(g), 40);
  age(id(fresh), 5);
  runPrune();
  assert.deepEqual([stale, pinned, fresh, author].map((g) => user(id(g))), [false, true, true, false]);
  assert.deepEqual(sql(`SELECT id FROM wp_tp_guest_carts WHERE id = ${cart.id}`), [], "cascade deleted the guest's cart");
  assert.deepEqual(sql(`SELECT memberId FROM wp_tp_guest_notes WHERE id = ${note.id}`), [{ memberId: "NULL" }], "set null kept the note, unowned");
  assert.deepEqual(sql(`SELECT memberId FROM wp_tp_guestbook WHERE id = ${entry.id}`), [{ memberId: String(id(pinned)) }], "the required reference kept its guest");
  assert.deepEqual(sql(`SELECT post_author FROM wp_posts WHERE ID = ${post}`), [{ post_author: "0" }]);
  assert.deepEqual(sql(`SELECT COUNT(*) AS n FROM wp_tp_identity_tokens WHERE wp_user_id = ${id(stale)}`), [{ n: "0" }], "identity forgot the pruned guest");
  const me = await fetch(`${api}/me`, { headers: { authorization: `Bearer ${stale.accessToken}` } });
  assert.equal(me.status, 401, "the pruned guest's token no longer signs in");
  // Without an auth collection, a core deletion hook can fail after priming empty metadata.
  // Rollback must restore the guest's roles in the same request, as well as its SQL rows.
  age(id(pinned), -40);
  const rollbackGuest = await guest();
  const laterGuest = await guest();
  age(id(rollbackGuest), 40);
  age(id(laterGuest), 40);
  const restored = JSON.parse(wp("eval", `
    $original = \\TypedPress\\Wp\\Runtime::plugin()->app()->db;
    \\TypedPress\\Db::setInstance(new \\TypedPress\\Db($original->store(), new \\TypedPress\\Schema([]), $original->media(), 'wp'));
    add_action('deleted_user', static function ($userId): void {
      if ($userId === ${id(rollbackGuest)}) {
        get_user_meta($userId);
        throw new RuntimeException('keep guest');
      }
    });
    $result = \\TypedPress\\Wp\\Guests::prune();
    $user = new WP_User(${id(rollbackGuest)});
    echo wp_json_encode([$result, $user->exists(), $user->roles, get_userdata(${id(laterGuest)}) === false]);
  `));
  assert.deepEqual(restored, [{ pruned: [id(laterGuest)], kept: [{ id: id(rollbackGuest), reason: "keep guest" }] }, true, ["tp_guest"], true]);
});

test("compiled arithmetic on stored and input integers past 2^53 matches JS; lookups stay exact", async () => {
  // MariaDB keeps 9007199254740993 exactly; JS can't even write it, so Node computes from the double.
  const exact = "9007199254740993";
  sql(`INSERT INTO wp_tp_big_counts (n) VALUES (${exact})`);
  const [row] = sql(`SELECT id FROM wp_tp_big_counts WHERE n = ${exact}`);
  const n = Number(exact), m = 2 ** 53 + 3; // what JS sees: both rounded to doubles
  const body = `{"id":${row.id},"m":9007199254740995}`;
  const res = await fetch(`${api}/actions/bigMath`, { method: "POST", headers: { ...auth("editor"), "content-type": "application/json" }, body });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.deepEqual(json.data, [n - 1, n + 1, n - 1, n * 1, -n, n + 1, m + 1, m - n, n + m, String(n + 0), Number(row.id)]);
});
