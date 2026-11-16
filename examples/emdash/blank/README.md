# Blank: start with a working admin

Original Zero counterpart of [EmDash blank at the pinned revision](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/templates/blank). Upstream provides an unseeded welcome page linking to its admin and a live-content loader; it has no post/page frontend, taxonomy archive, RSS or search page of its own. The upstream MIT notice is retained in `LICENSE.upstream`.

```sh
# Repository root; Node.js 22+ and an existing matching TypedPress binary.
TP_BIN="$PWD/target/debug/typedpress" node examples/emdash/blank/run.mjs
```

The launcher creates a unique disposable project and dynamic port using native TypedPress dev/Studio, installs the shared publication theme in blank mode, and prints the site/admin URLs and exact cleanup command. `typedpress.config.ts` deliberately defines no custom content collections. Native WordPress Posts, Pages, Media, Plugins and Settings are available; the welcome page links to the full WordPress admin. The initial local-only credentials are `admin / typedpress-test-admin` in this new disposable site. Nothing touches any existing site.

To try a real save, create and publish a native WordPress page with slug `typedpress-page`, then open `/typedpress-page`. Blank mode also renders native posts at `/posts/{slug}`. These native content routes and shared search/theme controls are TypedPress additions, not claims about upstream blank. There is no seeded publication data or application schema. The same data-driven WordPress theme is shared with starter to keep the implementation small.

Run the [shared acceptance](../starter/README.md#reproduce-acceptance):

```sh
TP_BIN="$PWD/target/debug/typedpress" node --test examples/emdash/starter/acceptance.test.mjs
```

Blank's case saves a native page through WordPress REST and fetches its published blocks, verifies the welcome page, login and full native settings, and cleans up its exact project and Studio registration. The test prints a `/tmp` evidence directory. The shared README documents all prerequisites, lifecycle ownership and implementation limitations.

For a manual launch, use the cleanup command printed for your exact project:

```sh
node examples/emdash/blank/run.mjs cleanup /tmp/typedpress-emdash-blank-EXACT
```

This is local WordPress/SQLite evidence, not proof of an EmDash database, Cloudflare deployment, sandbox runtime or provider parity.
