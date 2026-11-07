# Plugins as npm packages, with an inferred capability lock

Date: 2026-11-07. Status: accepted.

## Decision

Third-party plugins run in the same PHP process as the app, with no isolate.
The compiler is the security boundary. Zero compiles a closed subset of
TypeScript and refuses everything else, so compiled code can only reach the
Zero APIs it names. The compiler records each of those uses, per plugin, and
the committed lock file is what the app grants.

1. **A plugin is an installed npm package.** Its source calls
   `definePlugin({ name, hooks, actions, jobs, routes })` from `"zero"`. The
   app imports it and lists it in `defineConfig({ use: [seo(), ...] })`. The
   existing installed-package loader resolves it. The compiler never fetches
   or installs anything.
2. **Capabilities are inferred, not declared.** The compiler already sees
   every capability-bearing call reachable from a plugin, including calls
   through helpers it imports and values passed to them. Authors write no
   capability list, and the grant is never declared twice (in `package.json`
   and in `definePlugin`).
3. **The lock is the grant.** `zero build` writes `zero/plugins.lock.json`.
   Each entry holds the package name, version, a SHA-256 integrity of the
   source the compiler read, and the inferred grant. The owner approves it by
   committing it.
   - Growth after a package update (the integrity changed) updates the lock
     and prints a diff.
   - With `--frozen`, or when the `CI` environment variable is set, any
     growth, or a plugin missing from the lock, fails the build with a
     located diagnostic.
   - Narrowing: the owner edits an entry. The source is unchanged, so the
     inferred grant can only exceed the entry because of that edit, and the
     compiler refuses the code that exceeds it. There is no app-side
     `capabilities` override; editing the lock is the narrowing.
4. **Isolation.** A plugin package can import its own modules, `"zero"`, and
   ordinary npm packages. Those packages are compiled under the plugin's
   grant. It can't import app modules or another plugin's package (`Z1201`).
   Every compiled helper, captured value, and class (static state included) is
   emitted per plugin under a `plugin_<name>__` prefix, and `once()` receipts
   use a per-plugin scope, so two plugins sharing a pure package don't share
   state.
5. **Report, not refusal, for exfiltration.** A granted read plus a granted
   host can send data out; that's accepted. `zero check --json` adds a
   `plugins` report: each plugin's lock entry, its inferred grant, and the
   handlers that both read data (a query or an env value, in the handler or
   any helper it calls) and call `fetch` or `mail.send`. This is
   handler-level co-occurrence, not precise taint tracking. A hook's own row
   argument isn't counted as a read for the report, since every hook has one.

No CPU or memory limits. A plugin hook keeps app-hook semantics: a throw
aborts the request and rolls back its writes.

## The name `use`

`defineConfig({ plugins })` already pins WordPress.org plugins. Two meanings
under one key would make a typo silently mean the other thing. `use` is short,
reads as "use these", and holds values rather than version strings.

## Capability kinds

Every kind is a sorted set of strings, so the lock, its diff and the
narrowing check treat them all the same. A new kind is a new row here plus
the place that records it.

| Kind | Values | Inferred from |
|---|---|---|
| `read` | collection keys, `globals.<name>` | `db.query.*`, relation `with`/filters, hooked collections, `db.globals.*.get` |
| `write` | `<collection>.<field>`, `<collection>.*`, `globals.<name>` | `db.insert/update` value fields, before-hook mutation or replacement of `data` (through helpers too) |
| `delete` | collection keys | `db.delete` |
| `hooks` | `<collection>.<hook>` | registered plugin hooks |
| `actions`, `routes` | registered names; `METHOD /path` | registered plugin actions and routes |
| `http` | hosts; `*` for a URL built at runtime | `fetch` |
| `env` | variable names | `env()`, captured `env()` values, `crypto.hmacSha256` key names, signature secrets |
| `mail` | `send` | `mail.send` |
| `jobs` | the plugin's own job names | `jobs.<name>.enqueue` |
| `abilities` | reserved: calling WordPress abilities (`vendor/name`) | not implemented |
| `wpHooks` | reserved: registering WordPress actions and filters | not implemented |
| `php` | reserved: imported PHP functions as `<source>:<function>` (`wordpress:get_option`, `woocommerce:wc_get_order`) | not implemented: `"php/wordpress"`, `"php/<plugin-slug>"` and `"php"` imports |

`http` hosts: a URL with a static `https://host/` prefix (string, template or
concatenation) is checked at build time. A URL built at runtime records `*`.
In the lock, `*` allows any public host. If the owner replaces `*` with
hosts, dynamic calls stay allowed, and the generated PHP checks every hop's
host against that list (`zero_fetch_host_denied`). This is the one runtime
check, and it sits in front of the existing SSRF policy.

## Plugin surface

- `hooks.<collectionKey>.<hook>`: same signatures as app hooks. Per
  collection and hook, plugin hooks run in `use` order, then the app's hook.
  A before-hook's returned replacement becomes the next hook's `data`.
- `actions`, `jobs`, `routes`: registered as `<plugin>_<name>`. Route paths
  stay as written and share the app's collision rules. Inside a plugin,
  `jobs.<name>` names the plugin's own jobs.

## Not covered

- CPU and memory budgets (decided: none).
- Exfiltration through granted capabilities (decided: reported, not refused).
- Writing the inferred grant into a packed package for registries: left out.
  The lock is computed against the app's schema (field names, hooked
  collections), so a package-side copy would be advisory only.
- `abilities`, `wpHooks`, `php`: rows reserved above; sibling work implements
  them. Recording one is a `uses(kind, value, span)` call where its import is
  lowered; the lock, diff, narrowing and report need no change.
- `crypto` hashing and `once()` are not capabilities: they touch no data or
  network beyond what other kinds already cover.
