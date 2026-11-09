# Design: WordPress only

Zero compiles `zero.config.ts` into WordPress plugins. The second target, a
PHP + SQLite app served by `php -S`, is removed before any release. This
document records what goes, what stays, how the fast test lane survives, and
the order of the pull requests that carry the cut.

## 1. Rulings

- One target. `Target` disappears from the compiler, `target` from
  `zero.config.ts`, `types/zero`, the generated client and `schema.php`.
  Hook and rule contexts drop `target`.
- No migration path and no shims: the removed target never shipped.
- WordPress owns identity, media, jobs, mail, options, HTTP and the database
  connection. Zero keeps its shared core: `Db`, `Sql`, `Schema`, `Access`,
  `FieldAccess`, `Js`, the feature modules, the WordPress stores and the
  compiler.
- Zero runs on the databases WordPress runs on: MySQL, MariaDB, and SQLite
  through the official SQLite Database Integration plugin. SQLite is how the
  fast suites, `wp-env`-less development and WordPress Playground run Zero.

## 2. The spike: WordPress on SQLite

Measured against WordPress 7.1.4, SQLite Database Integration 3.1.2
(SQLite 3.45) and PHP 8.5, with Zero's real plugins built from this tree.

What works unchanged: install, the four platform plugins and `zero-identity`
activate; the generated MySQL migration applies statement for statement;
`information_schema.TABLES` reports InnoDB and utf8mb4 (so the engine check
passes); `GET_LOCK`, `FOR UPDATE`, `LOCK IN SHARE MODE`, `INSERT IGNORE`,
`UPDATE IGNORE`, `START TRANSACTION`/`ROLLBACK`, `ALTER TABLE … FIRST`,
`CAST(… AS SIGNED|DECIMAL)`, `DATE_FORMAT`, `CONCAT`, window functions and
the postmeta join shapes. Booting WordPress in one PHP process takes 0.6 s and
installing it 0.3 s, so a suite can own a fresh site per run without Docker
or a web server.

What breaks, and the fix for each (all product code: SQLite through the plugin is a supported
platform, not a test convenience):

| Problem | Fix |
| --- | --- |
| `$wpdb->dbh` is a PDO subclass, not `mysqli`; `Connection::mysqli()` refuses it | `Connection` runs statements through whichever handle `$wpdb` holds |
| the driver has no prepared statements (`prepare()` throws `IM001`) | positional `?` params are bound as quoted literals on the SQLite handle; numeric columns come back typed |
| `LIKE ? COLLATE x ESCAPE '\\'` fails on `ESCAPE` | a translated dialect (`Dialect::mysqlOnSqlite`): `LIKE BINARY` for `like`, plain `LIKE` for `ilike` |
| `DATE_FORMAT` mistranslates `%s`; `STR_TO_DATE`, `JSON_CONTAINS`, `JSON_OBJECTAGG`, `SUBSTRING_INDEX`, `ROW_COUNT()` missing | ISO timestamps and dates are string expressions on the translated dialect; the JSON functions and `SUBSTRING_INDEX` are registered on the driver's PDO at boot; `Connection::changes()` tracks `rowCount()` |
| `LIMIT 18446744073709551615` is a datatype mismatch | the dialect carries its "no limit" literal |
| unique, foreign-key and not-null errors arrive as SQLSTATE `23000` with SQLite text, not errno 1062/1451/1048 | `Connection` maps the constraint text onto the MySQL errno and message the stores already read |
| `VARBINARY` keys (jobs, receipts) are stored as BLOB and never equal a text literal | key parameters travel as `Wp\Bytes`: a blob literal on SQLite, the string on mysqli; uniqueness and lookups stay byte for byte |
| `ALTER TABLE` recreates the table inside the driver's own transaction, where `PRAGMA foreign_keys = OFF` is ignored: the DROP cascades into child rows | an `ALTER TABLE` run outside a Zero transaction (migrations) runs with the pragma off inside a transaction of ours, and commits only when `PRAGMA foreign_key_check` is clean, so a constraint added over orphan rows fails as on MySQL |
| `GET_LOCK` is a no-op returning `'1=1'` | `Connection::locked` holds a lock file beside the database on SQLite, `GET_LOCK` on MySQL |
| SQLite's `LIKE` folds ASCII case only | `ilike` on the translated dialect is `ZERO_ILIKE(expr, ?)`, a LIKE with Unicode case folding registered with the other functions |
| a `?` inside a quoted literal or comment counted as a placeholder | parameters and the `ALTER TABLE` guard read the statement through the driver's own MySQL lexer, so quoting, comments and executable comments mean what they will mean when it runs |

`Platform::problems` and `zero doctor` accept the plugin from version 3.1.2 (the `sqlite` pin in
`tests/fixtures/platform.json`). Supported databases are MySQL 8.0+, MariaDB 10.11+, or SQLite
through SQLite Database Integration 3.1.2+.

## 3. What goes

Runtime (`runtime/`): `bin/zero.php`, `Zero/Identity.php`,
`Zero/Auth/{Sessions,Throttle,Failed,Reused}.php`, `Zero/Store/*`,
`Zero/Media/SqliteFiles.php`, `Zero/Jobs/SqliteQueue.php`,
`Zero/Secret.php`, `Zero/Migrator.php` (its `statements()` splitter moves to
`Wp\Migrator`), `Zero/Sync/wordpress-functions.php`, the curl and stream
fallbacks in `Http.php`, the SQLite column of `SystemTables`, every
`instanceof SqliteStore` and `dialect()->name === 'sqlite'` branch, the
standalone worker loop (`jobs work`), `App::boot` building its own services,
`App::handleHttp` and the `/api` router, `Db::$target`.

Compiler and CLI (`src/`): `Target`, `--target`, `--wp`, the SQLite dialect
in `migrate.rs` and `zero/_generated/migrations/sqlite/`, `commands/{users,jobs}.rs`,
`dev::standalone`, the standalone half of `doctor`, the `/api` prefix in the
client and `sync/client.rs`, `Credential::Token`, the standalone half of
`config_migrate`.

Tests: `tests/e2e/standalone.test.ts`, `tests/system/standalone.test.ts`, the standalone legs
of `tests/compiler.rs`, `tests/config_migrate.rs` and `tests/wp_plugins.rs`,
`tests/php/blog_app.php`'s app-root assembler, `tests/fixtures/auth/0001_init.sql`.

Public text: `README.md`, `docs/*`, `runtime/client/README.md` and its three
generated copies, `types/zero/index.d.ts`, the examples' committed
`zero/_generated/migrations/sqlite/`, `.github/workflows/ci.yml` jobs.

## 4. What stays, and where its proof moves

Rule: one behaviour, one test; nothing loses its only proof.

- `tests/php/{js_parity,schema,sql (MySQL half),images,legacy,vendor_drift}`
  are pure and stay as they are.
- `tests/php/{db,blog,auth,files,jobs,webhooks,media,locales,sync}_test.php`
  boot WordPress on SQLite in-process (`tests/php/wp.php`: a fresh site in a
  temp dir, the platform plugins, the runtime and an app plugin assembled from
  a fixture, installed and activated by a child process) and drive Zero
  through `App::handle` as a WordPress user, the plugin's WP-CLI command, and
  the site's own `php -S` (`tests/php/wp-router.php`) where a client or the
  private-files probe needs a web server. Media sizes and localization each
  need a site of their own (app-wide settings), so they are suites of their
  own. Checks that proved SQLite-only mechanics (`data/secret`, `PRAGMA
  foreign_keys`, `__zero_migrations`, bearer tokens, `zero.php users`, the
  standalone worker loop, `/api` CORS, the SQLite rebuild migration) go; their
  WordPress counterparts are proven here (the per-app ledger, a failing
  migration statement, Action Scheduler as the worker, WordPress users as
  members, attachments as media) or already in `tests/wp` and `tests/identity`.
- `tests/sync.rs` builds the project for WordPress, installs it on the same
  kind of site (`php tests/php/wp.php serve`), and syncs over application
  passwords.
- The differential runner keeps `run-php.php` as a pure-PHP harness: it loads
  `bootstrap.php` and the compiled `functions.php`, no store.
- `tests/compiler.rs` builds for WordPress only; the pantry and blog
  behaviour checks that ran against `php -S` move to the WordPress-on-SQLite
  site (PR 2).

## 5. WordPress primitives adopted in the cut

`wp_safe_remote_post` is the only outbound HTTP; the signing secret is the
`zero_runtime_secret` option; `Env::get` reads constants; delivery is Action
Scheduler; media is `wp_insert_attachment`; users, sessions and tokens are
WordPress plus `zero-identity`. Noted for later, not in the cut: folding
`Wp\Connection`'s transaction bookkeeping into fewer pieces; retiring
`Zero\Media` as an interface now that `WpMedia` is its one implementation;
`wp_mail` for identity codes is already in place.

## 6. Pull requests

1. **Fast lane**: Zero on WordPress + SQLite (the table above), the
   in-process harness, `tests/php` re-homed, `tests/sync.rs` re-homed. The
   standalone runtime still exists in this PR; only `tests/e2e`,
   `tests/system/standalone.test.ts`, the differential runner and the
   standalone legs of `tests/compiler.rs` still use it.
2. **Runtime cut**: delete the runtime files in §3 and the branches they fed;
   `zero build` and `zero dev` refuse the standalone target and build WordPress
   by default (the compiler keeps `Target` until PR 3, so every PR is green on
   its own);
   `tests/e2e/standalone.test.ts`, `tests/system/standalone.test.ts` and
   `blog_app.php` go (`tests/e2e/blog-scenario.ts` stays: the WordPress REST
   tests drive it); the
   compiler's behaviour tests (pantry, blog sync, db globals, phase-2
   closures, the differential actions, the importer's checks) run on a
   WordPress-on-SQLite site served or loaded by `tests/php/wp.php`; the
   differential rules run as pure PHP over the runtime plugin.
3. **Compiler and CLI cut**: `Target`, `--target`, `--wp`, `users`, `tokens`,
   `jobs`, SQLite migrations (`zero/_generated/migrations/` holds the MySQL files
   directly), the standalone half of doctor, the client's `/api` prefix and
   `token` option, `ctx.target`, the examples' committed output; the
   standalone legs of the compiler, importer and client tests go.
4. **Public text**: README, docs, types, client README and regenerated
   examples, CI.

Each PR keeps every suite green on its own. The WordPress suites run on
MariaDB as before; the fast lane runs on SQLite.
