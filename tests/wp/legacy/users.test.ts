// Lane M2: an original Zero (0.8) Space's app users moved into the new app's `auth: true`
// collection (design §6.2), against real WordPress. users-run.sh seeded them through the ORIGINAL
// identity plugin with the new app inactive (or replayed the rows it wrote), then activated the
// members app and zero-identity.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, wp, wpTry } from "../env.ts";

const site = JSON.parse(readFileSync(process.env.ZERO_LEGACY_USERS!, "utf8"));
const { ada, bo, cy, other } = site.ids;
const migrate = (...flags: string[]) => JSON.parse(wpTry("zero", "migrate-legacy-users", "--space=legacy-space", ...flags));
const member = (id: number) => JSON.parse(wp("zero", "find", "members", JSON.stringify({ where: { id } }))).data[0] ?? null;
const meta = () => sql("SELECT user_id, meta_key, meta_value FROM wp_usermeta ORDER BY umeta_id");
const identity = () => sql("SELECT wp_user_id, status FROM wp_zero_identity_accounts ORDER BY wp_user_id");
/** Whether WpAuth refuses this user as suspended (what every Zero channel checks). */
const suspended = (id: number) =>
  JSON.parse(wpTry("eval", `wp_set_current_user(${id}); try { \\Zero\\Wp\\WpAuth::current(); echo 'false'; } catch (\\Zero\\HttpError $e) { echo json_encode($e->errorCode === 'suspended'); }`));
const harnessSh = join(dirname(fileURLToPath(import.meta.url)), "..", "harness.sh");

/** A harness.sh process the test drives; every wait fails on early exit or a deadline. */
function child(args: string[]) {
  // Its own process group, so a failed test stops docker's client too (closing the writer's stdin).
  const p = spawn(harnessSh, args, { stdio: ["pipe", "pipe", "pipe"], detached: true });
  let out = "";
  let err = "";
  let code: number | null = null;
  p.stdout.on("data", (c) => (out += c));
  p.stderr.on("data", (c) => (err += c));
  p.on("close", (c) => (code = c ?? 1));
  const until = async (what: string, ok: () => boolean, exitOk = false) => {
    const deadline = Date.now() + 30_000;
    while (!ok()) {
      if (code !== null && !exitOk) throw new Error(`process exited before ${what}: ${out.slice(-500)} ${err.slice(-500)}`);
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setImmediate(r));
    }
  };
  return {
    p,
    kill: () => code === null && process.kill(-p.pid!, "SIGTERM"),
    until,
    ready: () => until("ready", () => out.startsWith("ready\n")),
    output: async () => (await until("exit", () => code !== null, true), out.trim()),
  };
}

/** Whether another connection is running a statement that starts with `prefix` (the test user sees its own). */
const running = (prefix: string) =>
  Number(
    execFileSync(harnessSh, ["sql", `SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() AND INFO LIKE '${prefix}%'`], { encoding: "utf8", timeout: 10_000 })
      .trim()
      .split("\n")[1],
  ) > 0;

/**
 * Another writer racing the move: `body` runs in its own WordPress process and transaction, which
 * stays open (its locks held, its writes uncommitted, so invisible to the move's planning reads)
 * until the move's statement starting `blockedOn` waits on it; then it commits and the move goes on.
 */
async function race(body: string, blockedOn: string) {
  const writer = child(["wp", "eval", `global $wpdb; $wpdb->query('START TRANSACTION'); ${body} fwrite(STDOUT, "ready\\n"); fflush(STDOUT); fgets(STDIN); $wpdb->query('COMMIT');`]);
  let run: ReturnType<typeof child> | undefined;
  try {
    await writer.ready();
    run = child(["wp", "zero", "migrate-legacy-users", "--space=legacy-space"]);
    await run.until("the move to wait on the writer's lock", () => running(blockedOn));
    writer.p.stdin.end("go\n");
    await writer.output();
    return JSON.parse(await run.output());
  } finally {
    writer.kill();
    run?.kill();
  }
}

const passwords = () => sql(`SELECT ID, user_pass FROM wp_users WHERE ID IN (${ada}, ${bo}, ${cy}) ORDER BY ID`);

let passwordsBefore: Record<string, string>[];
before(() => {
  passwordsBefore = passwords();
});

test("before the move, zero-identity knows nothing of the app users, so a suspended one is not enforced", () => {
  // Activating the app already made every WordPress user a member with defaults (§6.2); what the
  // new app can't see is the original account state, kept in the original identity tables.
  assert.deepEqual(sql(`SELECT wp_user_id FROM wp_zero_identity_accounts WHERE wp_user_id IN (${ada}, ${bo}, ${cy})`), []);
  assert.equal(suspended(cy), false);
});

test("an inactive zero-identity refuses the run, though its tables remain", () => {
  wp("plugin", "deactivate", "zero-identity");
  try {
    const r = migrate("--dry-run");
    assert.deepEqual([r.error.code, r.error.pointer], ["legacy_unmappable", ""]);
  } finally {
    wp("plugin", "activate", "zero-identity");
  }
});

test("a dry run lists the Space's app users and writes nothing", () => {
  const before = [meta(), identity()];
  assert.deepEqual(migrate("--dry-run").data, { dryRun: true, collection: "members", users: [ada, bo, cy], skipped: [] });
  assert.deepEqual([meta(), identity()], before);
});

test("a failure after writes have begun rolls every user back, WordPress's caches included", () => {
  // The last user's zero-identity account insert fails inside MariaDB, after the first two moved.
  wp("eval", `$GLOBALS['wpdb']->query("CREATE TRIGGER zero_legacy_users_fail BEFORE INSERT ON wp_zero_identity_accounts FOR EACH ROW IF NEW.wp_user_id = ${cy} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected'; END IF") || exit(1);`);
  try {
    const before = [meta(), identity()];
    assert.equal(migrate().error.status, 500);
    assert.deepEqual([meta(), identity()], before);
  } finally {
    sql("DROP TRIGGER zero_legacy_users_fail");
  }
  // The object cache lives per request here, so prove it in one process: code that reads a moved
  // user inside the same transaction warms the cache with the new email; when the transaction then
  // rolls back, that process must read the old email again.
  const inProcess = JSON.parse(wp("eval", `
    $plugin = \\Zero\\Wp\\Runtime::plugin();
    $plugin->app();
    $GLOBALS['wpdb']->update($GLOBALS['wpdb']->users, ['user_email' => 'old-ada@example.test'], ['ID' => ${ada}]);
    clean_user_cache(${ada});
    try {
      $plugin->connection()->transaction(static function () use ($plugin) {
        (new \\Zero\\Wp\\Legacy\\Users($plugin->connection(), $plugin->schema))->run('legacy-space', false);
        get_userdata(${ada});
        throw new \\RuntimeException('a later step failed');
      });
    } catch (\\RuntimeException) {}
    $email = get_userdata(${ada})->user_email;
    $GLOBALS['wpdb']->update($GLOBALS['wpdb']->users, ['user_email' => 'ada@example.test'], ['ID' => ${ada}]);
    clean_user_cache(${ada});
    echo json_encode($email);
  `));
  assert.equal(inProcess, "old-ada@example.test");
});

test("generated unique values the database holds equal refuse the run, which writes nothing", () => {
  // The members app plus a unique `code` whose generated default gives Ada "InviteA" and Bo
  // "invitea": distinct bytes, but one value to MariaDB's collation, which every member write's
  // unique check uses.
  const before = [meta(), identity()];
  const r = JSON.parse(wp("eval", `
    eval('namespace ZeroApp; function legacy_case_code() { static $n = 0; return $n++ % 2 ? "invitea" : "InviteA"; }');
    $plugin = \\Zero\\Wp\\Runtime::plugin();
    $plugin->app();
    $raw = require $plugin->dir . '/zero/app/schema.php';
    $raw['collections']['members']['columns']['code'] = ['type' => 'text', 'unique' => true, 'rules' => ['max' => 191], 'default' => ['fn' => 'legacy_case_code']];
    try {
      $plugin->connection()->transaction(static fn () => (new \\Zero\\Wp\\Legacy\\Users($plugin->connection(), new \\Zero\\Schema($raw)))->run('legacy-space', false));
      echo json_encode('moved');
    } catch (\\Zero\\HttpError $e) {
      echo json_encode([$e->status, $e->errorCode, $e->pointer, $e->getMessage()]);
    }
  `));
  assert.deepEqual(r, [409, "unique_violation", `/users/${bo}/code`, `code 'invitea' already belongs to WordPress user ${ada}`]);
  assert.deepEqual([meta(), identity()], before);
});

test("app users get zero-identity accounts with their verified email, and stay members", () => {
  // Since activation Ada changed her WordPress email, lost a member field and gained a bio: the move
  // restores the address the original account verified and the declared defaults, and a column
  // without a default starts empty (the row its validators saw).
  sql(`UPDATE wp_users SET user_email = 'ada-new@example.test' WHERE ID = ${ada}`);
  sql(`DELETE FROM wp_usermeta WHERE user_id = ${ada} AND meta_key = 'zero_plan'`);
  sql(`INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (${ada}, 'zero_bio', 'set since')`);
  wp("cache", "flush");
  assert.deepEqual([member(ada).email, member(ada).plan ?? null, member(ada).bio], ["ada-new@example.test", null, "set since"]);
  assert.deepEqual(migrate().data.users, [ada, bo, cy]);
  assert.deepEqual(
    sql(`SELECT a.wp_user_id, a.status, e.normalized, e.verified_at > 0 AS verified FROM wp_zero_identity_accounts a JOIN wp_zero_identity_emails e ON e.id = a.primary_email_id WHERE a.wp_user_id IN (${ada}, ${bo}) ORDER BY a.wp_user_id`),
    [
      { wp_user_id: String(ada), status: "active", normalized: "ada@example.test", verified: "1" },
      { wp_user_id: String(bo), status: "active", normalized: "bo@example.test", verified: "1" },
    ],
  );
  assert.deepEqual(
    [ada, bo].map((id) => member(id)).map((m: any) => [m.id, m.email, m.name, m.plan]),
    [[ada, "ada@example.test", "Ada", "free"], [bo, "bo@example.test", "bo@example.test", "free"]],
  );
  // Defaults land in the forms WpUserStore and SCF keep, and read back as the declared values.
  assert.deepEqual(
    Object.fromEntries(sql(`SELECT meta_key, meta_value FROM wp_usermeta WHERE user_id = ${ada} AND meta_key IN ('zero_newsletter', 'zero_joinedOn', 'zero_welcomedAt', 'zero_topics')`).map((r) => [r.meta_key, r.meta_value])),
    { zero_newsletter: "1", zero_joinedOn: "20260301", zero_welcomedAt: "2026-03-01 10:00:00", zero_topics: 'a:2:{i:0;s:4:"news";i:1;s:6:"events";}' },
  );
  const ada_ = member(ada);
  assert.deepEqual([ada_.newsletter, ada_.joinedOn, ada_.welcomedAt, ada_.topics, ada_.bio], [true, "2026-03-01", "2026-03-01T10:00:00.000Z", ["news", "events"], null]);
  // ...and filter like any member's (a `has` on the serialized list).
  assert.ok(JSON.parse(wp("zero", "find", "members", JSON.stringify({ where: { topics: { has: "events" } } }))).data.some((m: any) => m.id === ada));
  // Passwords (and so existing sign-ins) are untouched.
  assert.deepEqual(passwords(), passwordsBefore);
  // Another Space's app user is not this app's to claim.
  assert.deepEqual(sql(`SELECT wp_user_id FROM wp_zero_identity_accounts WHERE wp_user_id = ${other}`), []);
  assert.deepEqual(sql(`SELECT meta_key FROM wp_usermeta WHERE user_id = ${other} AND meta_key = '_zero_legacy_member'`), []);
});

test("a suspended original account stays suspended in the new app", () => {
  assert.deepEqual(sql(`SELECT status FROM wp_zero_identity_accounts WHERE wp_user_id = ${cy}`), [{ status: "suspended" }]);
  // WpAuth refuses it on every channel: here, WordPress acting as that user.
  assert.equal(suspended(cy), true);
  assert.equal(suspended(ada), false);
});

/** An app user of the Space, active with a verified email on the original platform. */
const appUser = (login: string) => {
  const id = Number(wp("user", "create", login, `${login}@example.test`, "--porcelain"));
  wp("user", "meta", "add", String(id), "_spacefast_app_user", "legacy-space");
  sql(`INSERT INTO wp_sfi_emails (wp_user_id, normalized, verified_at, method) VALUES (${id}, '${login}@example.test', 1, 'email_code')`);
  sql(`INSERT INTO wp_sfi_accounts (wp_user_id, primary_email_id, status, created_at) VALUES (${id}, (SELECT id FROM wp_sfi_emails WHERE wp_user_id = ${id}), 'active', 0)`);
  return id;
};

test("a suspension zero-identity holds is never lifted by the move, even one committed mid-run", async () => {
  // Dee was suspended in the new app after activation, though active on the original platform.
  const dee = appUser("dee");
  sql(`INSERT INTO wp_zero_identity_accounts (wp_user_id, primary_email_id, status, created_at) VALUES (${dee}, NULL, 'suspended', 0)`);
  // Fay is suspended by another connection that commits only after the move planned her as active.
  const fay = appUser("fay");
  const r = await race(`$wpdb->query("INSERT INTO wp_zero_identity_accounts (wp_user_id, primary_email_id, status, created_at) VALUES (${fay}, NULL, 'suspended', 0)");`, "SELECT status FROM `wp_zero_identity_accounts`");
  assert.deepEqual(r.data.users, [dee, fay]);
  assert.deepEqual(sql(`SELECT status FROM wp_zero_identity_accounts WHERE wp_user_id IN (${dee}, ${fay}) ORDER BY wp_user_id`), [{ status: "suspended" }, { status: "suspended" }]);
  assert.deepEqual([suspended(dee), suspended(fay)], [true, true]);
});

test("an account zero-identity erased stays erased", () => {
  const gus = appUser("gus");
  sql(`INSERT INTO wp_zero_identity_accounts (wp_user_id, primary_email_id, status, created_at) VALUES (${gus}, NULL, 'deletion_requested', 0)`);
  wp("zero-identity", "erase", String(gus));
  const user = () => sql(`SELECT user_email, display_name FROM wp_users WHERE ID = ${gus}`);
  const erased = user();
  assert.deepEqual(erased, [{ user_email: "", display_name: "Deleted account" }]);
  assert.deepEqual(migrate().data, { dryRun: false, collection: "members", users: [], skipped: [{ id: gus, reason: "deleted account" }] });
  assert.deepEqual(user(), erased);
  assert.deepEqual(sql(`SELECT status, primary_email_id IS NULL AS noEmail FROM wp_zero_identity_accounts WHERE wp_user_id = ${gus}`), [{ status: "deleted", noEmail: "1" }]);
  assert.deepEqual(sql(`SELECT normalized FROM wp_zero_identity_emails WHERE wp_user_id = ${gus}`), []);
});

test("an email another user holds refuses the run, even one claimed mid-run", async () => {
  // The address the original account verified is taken by another WordPress user of the site (who
  // signed up in the new app), committing only after the move planned; Eve's own WordPress
  // email had changed since, so nothing else stands in the way.
  const id = appUser("eve");
  sql(`UPDATE wp_users SET user_email = 'eve-new@example.test' WHERE ID = ${id}`);
  const holder = Number(wp("user", "create", "eve2", "eve2@example.test", "--porcelain"));
  try {
    const r = await race(`$wpdb->query("UPDATE wp_users SET user_email = 'eve@example.test' WHERE ID = ${holder}");`, "SELECT ID FROM `wp_users` WHERE user_email");
    assert.deepEqual([r.error?.code, r.error?.pointer], ["unique_violation", `/users/${id}/email`], JSON.stringify(r));
    assert.deepEqual(sql(`SELECT ID FROM wp_users WHERE user_email = 'eve@example.test'`), [{ ID: String(holder) }]);
  } finally {
    for (const user of [id, holder]) wp("user", "delete", String(user), "--yes");
    sql(`DELETE FROM wp_sfi_accounts WHERE wp_user_id = ${id}`);
    sql(`DELETE FROM wp_sfi_emails WHERE wp_user_id = ${id}`);
  }
});

test("a second run changes nothing", () => {
  const before = [meta(), identity()];
  assert.deepEqual(migrate().data.users, []);
  assert.deepEqual([meta(), identity()], before);
});

test("an app user without a verified email refuses the run, naming the user", () => {
  const id = Number(wp("user", "create", "unverified", "unverified@example.test", "--porcelain"));
  wp("user", "meta", "add", String(id), "_spacefast_app_user", "legacy-space");
  sql(`INSERT INTO wp_sfi_accounts (wp_user_id, primary_email_id, status, created_at) VALUES (${id}, NULL, 'active', 0)`);
  const r = migrate();
  assert.deepEqual([r.error.code, r.error.pointer], ["invalid_input", `/users/${id}/email`]);
});
