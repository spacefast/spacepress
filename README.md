# Zero

Write `zero.config.ts` (Drizzle-style collections, relations, hooks, and actions).
`zero build` compiles it with Rust into a plain PHP app, or with `--target wp`
into a WordPress plugin (custom post types + Secure Custom Fields). Rust runs
only at build time; at runtime it's all PHP, with no JS engine and no Composer.

**Status: early.** The pantry example builds and runs end to end. Expect the API
to move.

## Try it

Requirements: Rust 1.96+ and PHP 8.2+ with `pdo_sqlite`.

```sh
cargo build --release
./target/release/zero dev examples/pantry      # build, then serve on :8787
```

```sh
curl -X POST localhost:8787/api/locations -d '{"name":"Fridge","kind":"fridge"}'
curl -X POST localhost:8787/api/items -d '{"name":" Eggs ","quantity":1,"locationId":1}'
curl localhost:8787/api/shopping_list            # the afterCreate hook added Eggs
curl -X POST localhost:8787/api/actions/consume -d '{"itemId":1}'
```

Writes need a user: `zero users add me --role editor` then `zero tokens create
me`, and send `Authorization: Bearer <token>`.

`zero check` compiles for both targets without writing anything. `zero build`
writes new migrations to `zero/migrations/{sqlite,wp}/` and the typed client to
`zero/client/` (commit both), and the app to `.zero/app`. `zero build --target
wp` writes `.zero/wp-content`, with separate runtime, optional identity, and
app plugins plus pinned dependencies, ZIPs and one manifest. `zero dev --wp`
boots that artifact in a throwaway WordPress (Docker). `zero doctor` checks a
build; add `--site URL` to check the running platform.

## How it works

1. **Parse.** [oxc](https://oxc.rs) parses `zero.config.ts` and the local `.ts`
   files it imports.
2. **Lower.** The syntax tree becomes Zero's own IR. Anything outside the
   supported subset (classes, `this`, `==`, `var`, npm imports, ...) fails the
   build with `file:line:col` and a suggested fix.
3. **Evaluate.** The config runs in a small, pure Rust evaluator: no I/O, no
   clock, a step budget. So composition works: helpers, factories, spreads, and
   shared field sets. The result is the schema as plain data.
4. **Compile.** Hooks and actions keep their captured scope. They're
   type-checked against the schema and compiled to PHP: native operators where
   the types make it safe, `Zero\Js` helpers where JavaScript and PHP differ,
   and a build error where neither is sound.
5. **Emit.** The output is SQLite and MySQL migrations (diffed against one
   committed snapshot), `schema.php`, `functions.php`, `zero.gen.ts` (types
   `db` in your editor), the typed client, and the PHP runtime: the database,
   the REST API, the hook pipeline, and the JS-semantics helpers.

Here's the hook above, as written and as compiled:

```ts
beforeCreate(data) {
  data.name = data.name.trim();
  if (data.name === "") throw new HttpError(422, "invalid_input", "name can't be empty");
  data.slug = slugify(data.name);
}
```

```php
function items__beforeCreate(array &$data)
{
    $data['name'] = \Zero\Js::trim($data['name']);
    if ($data['name'] === '') {
        throw new \Zero\HttpError((int) 422, 'invalid_input', 'name can\'t be empty');
    }
    $data['slug'] = \ZeroApp\slugify($data['name']);
}
```

## Docs

- [`docs/config-api.md`](docs/config-api.md): the `zero.config.ts` API and the
  enforced subset
- [`docs/runtime-contract.md`](docs/runtime-contract.md): the boundary between
  compiler output and the PHP runtime

## Tests

```sh
cargo test                     # rejections, goldens, HTTP, Node↔PHP differential, generated client (tsc or TSC)
tests/php/run.sh               # runtime: JS parity (checked against node) + DB/HTTP suite
cd types/zero/tests && tsc -p .  # the "zero" types catch real mistakes
```

## Layout

| Path | What |
|---|---|
| `src/lower.rs` | oxc AST → IR, enforcing the subset |
| `src/loader.rs` | module graph and import rules |
| `src/eval.rs`, `src/value.rs` | the build-time evaluator |
| `src/extract.rs` | evaluated config → schema + functions to compile |
| `src/compile.rs`, `src/types.rs` | typed TS → PHP compiler |
| `src/migrate.rs` | snapshots and SQLite/MySQL migration planning |
| `src/schema_php.rs` | `schema.php` and `zero.gen.ts` |
| `src/client.rs` | `zero/client/types.ts` and `schema.ts` |
| `runtime/` | the PHP runtime, embedded into the binary |
| `types/zero/` | TypeScript declarations for `"zero"` |
| `examples/pantry/` | home pantry tracker |
| `examples/blog/` | the CMS example (both targets) |

WordPress builds can also [declare additional pinned plugins](docs/wp-plugins.md) in `zero.config.ts`; see `examples/wp-plugins`.

Import a declarative CMS config with `zero migrate config --from emdash|payload|sanity|zero <input> --out <new/zero.config.ts>`. See [config migration](docs/config-migration.md) for the supported subset and [compatibility coverage](docs/zero-compatibility.md) for remaining original Zero features. To move a site built with the original Zero 0.8, follow [migrating from Zero 0.8](docs/migrating-from-zero.md) (`zero migrate site`).
